// Canonical parser for IHPU pressure logs.
//
// Pure TypeScript. No DOM, no Electron, no Chart.js, no PapaParse. Takes raw
// text in, returns a structured ParseResult. Reading the file off disk is the
// caller's job (renderer or test) — keeping IO outside the parser means the
// same function works inside a Vitest test, an Electron renderer, and a
// future server-side preprocessor without modification.
//
// The parser preserves raw data. Negative pressure values are valid input and
// are NOT filtered. Threshold logic (e.g. "T2 > 10 bar means hold-zone candidate")
// belongs to pressureAnalysis/holdPeriod, not here. See
// docs/development/parser-contract.md.

import {
  parseIhpuLocalDateTime,
  toDeterministicTimestampMs,
  toLocalIso,
  type DateTimeParts
} from '../utils/dateTime';
import type {
  ChannelPresence,
  ChannelStats,
  ParseIssue,
  ParseMeta,
  ParseOptions,
  ParseResult,
  PressureRow
} from './types';

interface CandidateRow {
  parts: DateTimeParts;
  p1: number | null;
  p2: number | null;
  sourceLine: number;
  raw: string;
  dateText: string;
  timeText: string;
}

interface LineParseOutcome {
  ok: boolean;
  parts?: DateTimeParts;
  p1: number | null;
  p2: number | null;
  dateText: string;
  timeText: string;
}

/**
 * Parse a raw IHPU pressure log into a structured ParseResult.
 *
 * Input is expected to be tab-separated with `<DATE> <TIME>\t<T1>\t<T2>` per
 * non-empty line. The parser also accepts whitespace-separated input as a
 * fallback when no tab is present.
 *
 * The parser never throws on malformed data — it records issues and returns
 * what could be parsed. Empty input or input where no row produces a valid
 * timestamp will return rows: [] and an error in `errors`.
 */
export function parseIhpuPressureLog(input: string, options: ParseOptions = {}): ParseResult {
  const { sourceName, sortRows = true } = options;
  const issues: ParseIssue[] = [];

  const allLines = input.split(/\r?\n/);
  const totalLines = allLines.length;

  if (input.trim().length === 0) {
    issues.push({
      severity: 'error',
      code: 'EMPTY_INPUT',
      line: 0,
      message: 'input is empty'
    });
  }

  let nonEmptyLines = 0;
  let skippedLines = 0;
  const candidates: CandidateRow[] = [];

  for (let i = 0; i < allLines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = allLines[i] ?? '';
    if (rawLine.trim().length === 0) continue;
    nonEmptyLines++;

    const outcome = parseSingleLine(rawLine, lineNumber, issues);
    if (!outcome.ok || !outcome.parts) {
      skippedLines++;
      continue;
    }

    candidates.push({
      parts: outcome.parts,
      p1: outcome.p1,
      p2: outcome.p2,
      sourceLine: lineNumber,
      raw: rawLine,
      dateText: outcome.dateText,
      timeText: outcome.timeText
    });
  }

  if (candidates.length === 0 && input.trim().length > 0) {
    issues.push({
      severity: 'error',
      code: 'NO_VALID_ROWS',
      line: 0,
      message: 'no valid pressure rows could be parsed from input'
    });
  } else if (candidates.length === 0) {
    // EMPTY_INPUT is already recorded; surface NO_VALID_ROWS too so meta is uniform.
    issues.push({
      severity: 'error',
      code: 'NO_VALID_ROWS',
      line: 0,
      message: 'no valid pressure rows could be parsed from input'
    });
  }

  // Detect unsorted before sorting so the warning reflects the user's input.
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
      message: 'input rows were not in ascending timestamp order; output is sorted ascending'
    });
  }

  if (sortRows) {
    candidates.sort((a, b) => {
      const ta = toDeterministicTimestampMs(a.parts);
      const tb = toDeterministicTimestampMs(b.parts);
      if (ta !== tb) return ta - tb;
      return a.sourceLine - b.sourceLine;
    });
  }

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

  const rows: PressureRow[] = candidates.map((c, index) => {
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
    p1: computeChannelStats(rows, 'p1'),
    p2: computeChannelStats(rows, 'p2')
  };

  const channelsPresent: ChannelPresence = {
    p1: channelStats.p1.count > 0,
    p2: channelStats.p2.count > 0
  };

  const meta: ParseMeta = {
    sourceName,
    totalLines,
    nonEmptyLines,
    parsedRows: rows.length,
    skippedLines,
    firstTimestampMs,
    lastTimestampMs,
    durationMinutes,
    channelsPresent,
    channelStats
  };

  const warnings = issues.filter((i) => i.severity === 'warning');
  const errors = issues.filter((i) => i.severity === 'error');

  return { rows, issues, warnings, errors, meta };
}

function parseSingleLine(rawLine: string, lineNumber: number, issues: ParseIssue[]): LineParseOutcome {
  const hasTab = rawLine.includes('\t');
  let dateTimeStr: string;
  let p1Cell: string | undefined;
  let p2Cell: string | undefined;

  if (hasTab) {
    const fields = rawLine.split('\t').map((f) => f.trim());
    dateTimeStr = fields[0] ?? '';
    p1Cell = fields[1];
    p2Cell = fields[2];
    if (fields.length > 3) {
      issues.push({
        severity: 'warning',
        code: 'EXTRA_COLUMNS',
        line: lineNumber,
        message: `expected 3 tab-separated columns, found ${fields.length}; using first 3`,
        raw: rawLine
      });
    }
  } else {
    // Whitespace fallback: <date> <time> <T1> <T2>
    const fields = rawLine.trim().split(/\s+/);
    if (fields.length < 2) {
      issues.push({
        severity: 'error',
        code: 'MALFORMED_LINE',
        line: lineNumber,
        message: 'line could not be split into date and time fields',
        raw: rawLine
      });
      return { ok: false, p1: null, p2: null, dateText: '', timeText: '' };
    }
    dateTimeStr = fields[0] + ' ' + fields[1];
    p1Cell = fields[2];
    p2Cell = fields[3];
    if (fields.length > 4) {
      issues.push({
        severity: 'warning',
        code: 'EXTRA_COLUMNS',
        line: lineNumber,
        message: `expected 4 whitespace-separated fields, found ${fields.length}; using first 4`,
        raw: rawLine
      });
    }
  }

  const parts = parseIhpuLocalDateTime(dateTimeStr);
  if (!parts) {
    issues.push({
      severity: 'error',
      code: 'INVALID_TIMESTAMP',
      line: lineNumber,
      field: 'timestamp',
      message: `unrecognized timestamp: "${dateTimeStr}"`,
      raw: rawLine
    });
    return { ok: false, p1: null, p2: null, dateText: '', timeText: '' };
  }

  const tsTrim = dateTimeStr.trim();
  const tsSplitAt = tsTrim.search(/\s/);
  const dateText = tsSplitAt === -1 ? tsTrim : tsTrim.slice(0, tsSplitAt);
  const timeText = tsSplitAt === -1 ? '' : tsTrim.slice(tsSplitAt + 1).trim();

  const p1 = parseNumberCell(p1Cell, lineNumber, 'p1', issues, rawLine);
  const p2 = parseNumberCell(p2Cell, lineNumber, 'p2', issues, rawLine);

  return { ok: true, parts, p1, p2, dateText, timeText };
}

function parseNumberCell(
  value: string | undefined,
  lineNumber: number,
  field: 'p1' | 'p2',
  issues: ParseIssue[],
  raw: string
): number | null {
  if (value === undefined || value === '') {
    issues.push({
      severity: 'warning',
      code: 'MISSING_VALUE',
      line: lineNumber,
      field,
      message: `missing ${field} value`,
      raw
    });
    return null;
  }
  // Accept European decimal comma. Replace only the FIRST comma to be safe;
  // a value like "1,234,5" would still be invalid and get flagged below.
  const normalized = value.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    issues.push({
      severity: 'warning',
      code: 'INVALID_NUMBER',
      line: lineNumber,
      field,
      message: `${field} is not a valid number: "${value}"`,
      raw
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
