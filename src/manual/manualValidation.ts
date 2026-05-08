// Validation for manual data entry.
//
// Pure: takes ManualRow[] in, returns ManualValidationResult out. No DOM,
// no IO. Reused by the live-validation render path in events.ts and by the
// paste handler. Imports from src/utils/dateTime so date/time parsing
// behaviour matches the file parser bit-for-bit.

import {
  parseDateParts,
  parseTimeParts,
  toDeterministicTimestampMs,
  type DateTimeParts
} from '../utils/dateTime';
import {
  newManualRow,
  type ManualIssue,
  type ManualPasteOutcome,
  type ManualRow,
  type ManualValidationResult
} from './manualTypes';

/**
 * Validate a list of manual rows. Per-row checks (invalid date, invalid
 * number, no channels) plus collection-level checks (duplicates, sort
 * order). Never throws.
 */
export function validateManualRows(rows: ManualRow[]): ManualValidationResult {
  const errors: ManualIssue[] = [];
  const warnings: ManualIssue[] = [];

  let validRowCount = 0;
  const validatedTimestamps: Array<{ row: ManualRow; rowIndex: number; ms: number }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowIndex = i + 1;
    const isEmpty =
      row.dateText.trim() === '' &&
      row.timeText.trim() === '' &&
      row.p1Text.trim() === '' &&
      row.p2Text.trim() === '';
    if (isEmpty) {
      errors.push({
        severity: 'error',
        code: 'EMPTY_ROW',
        rowIndex,
        rowId: row.id,
        message: `Rad ${rowIndex}: tom — fyll inn dato, tid og minst ett trykk.`
      });
      continue;
    }

    const parts = validateRow(row, rowIndex, errors);
    if (!parts) continue;

    const { p1, p2 } = parts;
    if (p1 === null && p2 === null) {
      // validateRow already pushed NO_CHANNELS or INVALID_NUMBER if applicable;
      // skip stats for this row.
      continue;
    }

    validRowCount++;
    validatedTimestamps.push({ row, rowIndex, ms: parts.timestampMs });
  }

  // Cross-row checks
  if (validatedTimestamps.length > 1) {
    const seen = new Map<number, number>(); // ms -> first rowIndex seen
    let isSorted = true;
    let lastMs = Number.NEGATIVE_INFINITY;

    for (const { rowIndex, ms, row } of validatedTimestamps) {
      const firstSeen = seen.get(ms);
      if (firstSeen !== undefined) {
        warnings.push({
          severity: 'warning',
          code: 'DUPLICATE_TIMESTAMP',
          rowIndex,
          rowId: row.id,
          message: `Rad ${rowIndex}: duplikat tidspunkt med rad ${firstSeen}.`
        });
      } else {
        seen.set(ms, rowIndex);
      }
      if (ms < lastMs) isSorted = false;
      lastMs = ms;
    }

    if (!isSorted) {
      warnings.push({
        severity: 'warning',
        code: 'UNSORTED',
        rowIndex: 0,
        rowId: '',
        message: 'Rader er ikke i tidsstigende rekkefølge — sorteres automatisk i analyse.'
      });
    }
  }

  if (rows.length > 0 && validRowCount === 0) {
    errors.push({
      severity: 'error',
      code: 'NO_VALID_ROWS',
      rowIndex: 0,
      rowId: '',
      message: 'Ingen gyldige manuelle rader.'
    });
  }

  return {
    validRowCount,
    totalRowCount: rows.length,
    errors,
    warnings,
    issues: [...errors, ...warnings]
  };
}

interface RowValidationOk {
  parts: DateTimeParts;
  timestampMs: number;
  p1: number | null;
  p2: number | null;
}

function validateRow(
  row: ManualRow,
  rowIndex: number,
  errors: ManualIssue[]
): RowValidationOk | null {
  const dateParts = parseDateParts(row.dateText);
  if (!dateParts) {
    errors.push({
      severity: 'error',
      code: 'INVALID_DATE',
      rowIndex,
      rowId: row.id,
      field: 'date',
      message: `Rad ${rowIndex}: ugyldig dato "${row.dateText.trim()}". Bruk DD.MM.YYYY eller YYYY-MM-DD.`
    });
    return null;
  }

  const timeParts = parseTimeParts(row.timeText);
  if (!timeParts) {
    errors.push({
      severity: 'error',
      code: 'INVALID_TIME',
      rowIndex,
      rowId: row.id,
      field: 'time',
      message: `Rad ${rowIndex}: ugyldig tid "${row.timeText.trim()}". Bruk HH:MM eller HH:MM:SS.`
    });
    return null;
  }

  const p1 = parsePressureCell(row.p1Text, 'p1', row, rowIndex, errors);
  const p2 = parsePressureCell(row.p2Text, 'p2', row, rowIndex, errors);

  if (p1 === null && p2 === null && row.p1Text.trim() === '' && row.p2Text.trim() === '') {
    errors.push({
      severity: 'error',
      code: 'NO_CHANNELS',
      rowIndex,
      rowId: row.id,
      message: `Rad ${rowIndex}: minst én av T1/T2 må være et gyldig tall.`
    });
    return null;
  }

  const parts: DateTimeParts = { ...dateParts, ...timeParts };
  const timestampMs = toDeterministicTimestampMs(parts);
  return { parts, timestampMs, p1, p2 };
}

function parsePressureCell(
  text: string,
  field: 'p1' | 'p2',
  row: ManualRow,
  rowIndex: number,
  errors: ManualIssue[]
): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    errors.push({
      severity: 'error',
      code: 'INVALID_NUMBER',
      rowIndex,
      rowId: row.id,
      field,
      message: `Rad ${rowIndex}: ugyldig ${field.toUpperCase()}-verdi "${trimmed}".`
    });
    return null;
  }
  return n;
}

/**
 * Parse pasted tab-separated text into ManualRow objects. Accepts:
 *   - `DD.MM.YYYY HH:MM:SS\tT1\tT2`     (3 tab fields, date+time combined)
 *   - `DD.MM.YYYY\tHH:MM:SS\tT1\tT2`    (4 tab fields)
 *   - whitespace fallback when no tabs are present
 *
 * Skips blank lines silently. Per-line issues are recorded and returned;
 * malformed lines do not abort the rest of the paste.
 */
export function parseManualPaste(text: string): ManualPasteOutcome {
  const issues: ManualIssue[] = [];
  const rows: ManualRow[] = [];
  let imported = 0;
  let rejected = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '') continue;

    const parsed = splitPasteLine(raw);
    if (!parsed) {
      rejected++;
      issues.push({
        severity: 'error',
        code: 'INVALID_DATE',
        rowIndex: i + 1,
        rowId: '',
        message: `Linje ${i + 1}: kunne ikke deles opp som "DD.MM.YYYY HH:MM:SS<TAB>T1<TAB>T2".`
      });
      continue;
    }

    const row = newManualRow({
      dateText: parsed.dateText,
      timeText: parsed.timeText,
      p1Text: parsed.p1Text,
      p2Text: parsed.p2Text
    });
    rows.push(row);
    imported++;
  }

  // Validate the produced rows en bloc so duplicate / sort warnings surface.
  if (rows.length > 0) {
    const validation = validateManualRows(rows);
    issues.push(...validation.errors, ...validation.warnings);
  }

  return { rows, issues, imported, rejected };
}

function splitPasteLine(raw: string): { dateText: string; timeText: string; p1Text: string; p2Text: string } | null {
  if (raw.includes('\t')) {
    const fields = raw.split('\t').map((f) => f.trim());
    if (fields.length === 3) {
      // `DD.MM.YYYY HH:MM:SS<TAB>T1<TAB>T2`
      const dt = splitDateTime(fields[0]!);
      if (!dt) return null;
      return { ...dt, p1Text: fields[1] ?? '', p2Text: fields[2] ?? '' };
    }
    if (fields.length >= 4) {
      // `DD.MM.YYYY<TAB>HH:MM:SS<TAB>T1<TAB>T2`
      return {
        dateText: fields[0] ?? '',
        timeText: fields[1] ?? '',
        p1Text: fields[2] ?? '',
        p2Text: fields[3] ?? ''
      };
    }
    return null;
  }

  // Whitespace fallback: `DD.MM.YYYY HH:MM:SS T1 T2` (4 fields)
  const fields = raw.trim().split(/\s+/);
  if (fields.length < 3) return null;
  if (fields.length === 4) {
    return {
      dateText: fields[0]!,
      timeText: fields[1]!,
      p1Text: fields[2]!,
      p2Text: fields[3]!
    };
  }
  if (fields.length >= 5) {
    // First two are date+time, third is T1, fourth is T2 (extras ignored).
    return {
      dateText: fields[0]!,
      timeText: fields[1]!,
      p1Text: fields[2]!,
      p2Text: fields[3]!
    };
  }
  return null;
}

function splitDateTime(combined: string): { dateText: string; timeText: string } | null {
  const trimmed = combined.trim();
  const splitAt = trimmed.search(/\s/);
  if (splitAt === -1) return null;
  return {
    dateText: trimmed.slice(0, splitAt),
    timeText: trimmed.slice(splitAt + 1).trim()
  };
}
