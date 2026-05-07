// Pressure-drop analysis for IHPU trykktest logs.
//
// Pure TypeScript domain logic. Consumes parser output (PressureRow[]) and
// produces a structured PressureDropResult. No DOM, no Electron, no Chart.js,
// no jsPDF. The chart, CSV, and PDF layers will all consume PressureDropResult
// — they must not re-derive numbers from raw rows.
//
// See docs/development/pressure-analysis-contract.md.

import type {
  AnalysisIssue,
  PressureChannel,
  PressureDropOptions,
  PressureDropResult,
  PressureRow
} from './types';

/**
 * Filter rows to those whose timestampMs falls in [fromMs, toMs] (inclusive).
 * Either bound may be omitted to leave that side unbounded.
 *
 * Out-of-order or null bounds where from > to result in an empty array.
 * The returned array is a new shallow copy; the input is never mutated.
 */
export function selectRowsInTimeRange(
  rows: PressureRow[],
  fromMs?: number,
  toMs?: number
): PressureRow[] {
  if (rows.length === 0) return [];
  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) return [];

  const lo = fromMs ?? Number.NEGATIVE_INFINITY;
  const hi = toMs ?? Number.POSITIVE_INFINITY;
  return rows.filter((r) => r.timestampMs >= lo && r.timestampMs <= hi);
}

/**
 * Calculate pressure-drop metrics for a given channel over a list of rows.
 *
 * Returns a structured PressureDropResult. The function never throws on bad
 * input — degenerate cases (no valid rows, single point, zero duration, etc.)
 * are surfaced as `errors` and the relevant numeric fields are set to null.
 *
 * Rows whose chosen channel value is null are skipped silently (they are not
 * input errors at this layer — that's the parser's concern).
 */
export function calculatePressureDrop(
  rows: PressureRow[],
  channel: PressureChannel,
  options: PressureDropOptions = {}
): PressureDropResult {
  const warnings: AnalysisIssue[] = [];
  const errors: AnalysisIssue[] = [];

  // Filter to rows where the chosen channel has a numeric value.
  const valid: { row: PressureRow; value: number }[] = [];
  for (const row of rows) {
    const v = row[channel];
    if (v !== null && Number.isFinite(v)) {
      valid.push({ row, value: v });
    }
  }

  if (valid.length === 0) {
    if (rows.length === 0) {
      errors.push({
        severity: 'error',
        code: 'NO_VALID_ROWS',
        message: 'no rows provided to calculatePressureDrop'
      });
    } else {
      errors.push({
        severity: 'error',
        code: 'CHANNEL_NOT_PRESENT',
        message: `channel '${channel}' has no valid numeric values in the provided rows`
      });
    }
    return emptyResult(channel, options.targetPressure, warnings, errors);
  }

  if (valid.length < 2) {
    errors.push({
      severity: 'error',
      code: 'INSUFFICIENT_POINTS',
      message: `need at least 2 valid points for channel '${channel}', got ${valid.length}`,
      detail: `valid count: ${valid.length}`
    });
    const only = valid[0]!;
    return {
      channel,
      rowsUsed: 1,
      startPressure: only.value,
      endPressure: only.value,
      startTimestampMs: only.row.timestampMs,
      endTimestampMs: only.row.timestampMs,
      referencePressure: options.targetPressure ?? only.value,
      durationMinutes: null,
      dropBar: null,
      dropPct: null,
      dropBarPerMinute: null,
      dropBarPerHour: null,
      warnings,
      errors
    };
  }

  const first = valid[0]!;
  const last = valid[valid.length - 1]!;

  const startPressure = first.value;
  const endPressure = last.value;
  const startTimestampMs = first.row.timestampMs;
  const endTimestampMs = last.row.timestampMs;
  const dropBar = startPressure - endPressure;

  const durationMs = endTimestampMs - startTimestampMs;
  const durationMinutes = durationMs / 60_000;

  if (durationMs <= 0) {
    errors.push({
      severity: 'error',
      code: 'ZERO_DURATION',
      message: `duration between first and last valid row is zero or negative (${durationMs} ms)`
    });
    return {
      channel,
      rowsUsed: valid.length,
      startPressure,
      endPressure,
      startTimestampMs,
      endTimestampMs,
      referencePressure: options.targetPressure ?? startPressure,
      durationMinutes,
      dropBar,
      dropPct: null,
      dropBarPerMinute: null,
      dropBarPerHour: null,
      warnings,
      errors
    };
  }

  const reference =
    options.targetPressure !== undefined && Number.isFinite(options.targetPressure)
      ? options.targetPressure
      : startPressure;

  let dropPct: number | null;
  if (reference === 0) {
    errors.push({
      severity: 'error',
      code: 'INVALID_REFERENCE',
      message: 'reference pressure for dropPct is 0 — cannot divide'
    });
    dropPct = null;
  } else {
    dropPct = dropBar / Math.abs(reference);
  }

  const dropBarPerMinute = dropBar / durationMinutes;
  const dropBarPerHour = dropBar / (durationMinutes / 60);

  return {
    channel,
    rowsUsed: valid.length,
    startPressure,
    endPressure,
    startTimestampMs,
    endTimestampMs,
    referencePressure: reference,
    durationMinutes,
    dropBar,
    dropPct,
    dropBarPerMinute,
    dropBarPerHour,
    warnings,
    errors
  };
}

function emptyResult(
  channel: PressureChannel,
  targetPressure: number | undefined,
  warnings: AnalysisIssue[],
  errors: AnalysisIssue[]
): PressureDropResult {
  return {
    channel,
    rowsUsed: 0,
    startPressure: null,
    endPressure: null,
    startTimestampMs: null,
    endTimestampMs: null,
    referencePressure: targetPressure ?? null,
    durationMinutes: null,
    dropBar: null,
    dropPct: null,
    dropBarPerMinute: null,
    dropBarPerHour: null,
    warnings,
    errors
  };
}
