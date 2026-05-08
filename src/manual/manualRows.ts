// Convert validated ManualRow[] into a parser-shaped ParseResult so the rest
// of the pipeline (analysis, chart, report) can consume manual data through
// the exact same path it consumes file-uploaded data.
//
// CRITICAL: this module produces the same `ParseResult` type the parser
// produces. It does NOT define a parallel analysis pipeline. Downstream code
// stays unchanged.

import {
  parseDateParts,
  parseTimeParts,
  toDeterministicTimestampMs,
  toLocalIso,
  type DateTimeParts
} from '../utils/dateTime';
import type {
  ChannelStats,
  ParseIssue,
  ParseMeta,
  ParseResult,
  PressureRow
} from '../domain/types';
import type { ManualRow } from './manualTypes';

/**
 * Build a ParseResult from a list of manual rows. Invalid rows (bad date,
 * bad time, no valid channel) are dropped and represented as ParseIssues.
 *
 * @param rows the operator's raw manual rows
 * @param sourceName label used in `meta.sourceName` (default 'Manual entry')
 */
export function buildManualParseResult(
  rows: ManualRow[],
  sourceName = 'Manual entry'
): ParseResult {
  const issues: ParseIssue[] = [];

  interface Candidate {
    parts: DateTimeParts;
    p1: number | null;
    p2: number | null;
    sourceLine: number;
    raw: string;
    dateText: string;
    timeText: string;
  }

  const candidates: Candidate[] = [];
  let nonEmptyLines = 0;
  let skippedLines = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sourceLine = i + 1;

    const isEmpty =
      row.dateText.trim() === '' &&
      row.timeText.trim() === '' &&
      row.p1Text.trim() === '' &&
      row.p2Text.trim() === '';
    if (isEmpty) continue;
    nonEmptyLines++;

    const dateParts = parseDateParts(row.dateText);
    if (!dateParts) {
      skippedLines++;
      issues.push({
        severity: 'error',
        code: 'INVALID_TIMESTAMP',
        line: sourceLine,
        field: 'date',
        message: `Manuell rad ${sourceLine}: ugyldig dato "${row.dateText.trim()}"`
      });
      continue;
    }

    const timeParts = parseTimeParts(row.timeText);
    if (!timeParts) {
      skippedLines++;
      issues.push({
        severity: 'error',
        code: 'INVALID_TIMESTAMP',
        line: sourceLine,
        field: 'time',
        message: `Manuell rad ${sourceLine}: ugyldig tid "${row.timeText.trim()}"`
      });
      continue;
    }

    const p1 = parseCell(row.p1Text, 'p1', sourceLine, issues);
    const p2 = parseCell(row.p2Text, 'p2', sourceLine, issues);

    if (p1 === null && p2 === null) {
      skippedLines++;
      issues.push({
        severity: 'error',
        code: 'NO_VALID_ROWS',
        line: sourceLine,
        message: `Manuell rad ${sourceLine}: ingen gyldige trykkverdier.`
      });
      continue;
    }

    const parts: DateTimeParts = { ...dateParts, ...timeParts };
    const raw = `${row.dateText.trim()} ${row.timeText.trim()}\t${row.p1Text.trim()}\t${row.p2Text.trim()}`;
    candidates.push({
      parts,
      p1,
      p2,
      sourceLine,
      raw,
      dateText: row.dateText.trim(),
      timeText: row.timeText.trim()
    });
  }

  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_INPUT',
      line: 0,
      message: 'Ingen manuelle rader er registrert.'
    });
  } else if (candidates.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_VALID_ROWS',
      line: 0,
      message: 'Ingen gyldige manuelle rader.'
    });
  }

  // Sort ascending by timestamp, stable on sourceLine. Same as parser.
  let isPreSorted = true;
  for (let i = 1; i < candidates.length; i++) {
    const prev = toDeterministicTimestampMs(candidates[i - 1]!.parts);
    const cur = toDeterministicTimestampMs(candidates[i]!.parts);
    if (cur < prev) {
      isPreSorted = false;
      break;
    }
  }
  if (!isPreSorted) {
    issues.push({
      severity: 'warning',
      code: 'UNSORTED_INPUT',
      line: 0,
      message: 'Manuelle rader var ikke i stigende tidsrekkefølge; sortert i analyse.'
    });
  }
  candidates.sort((a, b) => {
    const ta = toDeterministicTimestampMs(a.parts);
    const tb = toDeterministicTimestampMs(b.parts);
    if (ta !== tb) return ta - tb;
    return a.sourceLine - b.sourceLine;
  });

  const firstTimestampMs =
    candidates.length > 0 ? toDeterministicTimestampMs(candidates[0]!.parts) : null;
  const lastTimestampMs =
    candidates.length > 0
      ? toDeterministicTimestampMs(candidates[candidates.length - 1]!.parts)
      : null;
  const durationMinutes =
    firstTimestampMs !== null && lastTimestampMs !== null
      ? (lastTimestampMs - firstTimestampMs) / 60_000
      : null;

  const pressureRows: PressureRow[] = candidates.map((c, index) => {
    const ts = toDeterministicTimestampMs(c.parts);
    const tMinutes = firstTimestampMs !== null ? (ts - firstTimestampMs) / 60_000 : 0;
    return {
      index,
      sourceLine: c.sourceLine,
      raw: c.raw,
      dateText: c.dateText,
      timeText: c.timeText,
      localIso: toLocalIso(c.parts),
      timestampMs: ts,
      tMinutes,
      p1: c.p1,
      p2: c.p2
    };
  });

  const channelStats = {
    p1: computeChannelStats(pressureRows, 'p1'),
    p2: computeChannelStats(pressureRows, 'p2')
  };

  const meta: ParseMeta = {
    sourceName,
    totalLines: rows.length,
    nonEmptyLines,
    parsedRows: pressureRows.length,
    skippedLines,
    firstTimestampMs,
    lastTimestampMs,
    durationMinutes,
    channelsPresent: {
      p1: channelStats.p1.count > 0,
      p2: channelStats.p2.count > 0
    },
    channelStats
  };

  const warnings = issues.filter((i) => i.severity === 'warning');
  const errors = issues.filter((i) => i.severity === 'error');

  return { rows: pressureRows, issues, warnings, errors, meta };
}

function parseCell(
  text: string,
  field: 'p1' | 'p2',
  line: number,
  issues: ParseIssue[]
): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    issues.push({
      severity: 'warning',
      code: 'INVALID_NUMBER',
      line,
      field,
      message: `Manuell rad ${line}: ${field.toUpperCase()} "${trimmed}" er ikke et gyldig tall — felt satt til null.`
    });
    return null;
  }
  return n;
}

function computeChannelStats(rows: PressureRow[], field: 'p1' | 'p2'): ChannelStats {
  let count = 0;
  let nullCount = 0;
  let min: number | null = null;
  let max: number | null = null;
  let first: number | null = null;
  let last: number | null = null;

  for (const row of rows) {
    const v = row[field];
    if (v === null) {
      nullCount++;
      continue;
    }
    count++;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
    if (first === null) first = v;
    last = v;
  }

  return { count, nullCount, min, max, first, last };
}
