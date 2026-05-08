// reportRows.ts — shared row-filtering for CSV and PDF exporters.
//
// Both CSV (`csvExport.ts`) and PDF (`pdfReport.ts`) emit a raw-rows section
// using EXACTLY the same selected-period filtering rule, so the operator
// cannot end up with a CSV and PDF that disagree on which rows belong to
// the report. Centralising the filter here makes that contract explicit.

import type { PressureRow } from '../domain/types';
import type { ReportModel } from './reportTypes';

/**
 * Filter `rows` to those whose `timestampMs` falls inside the selected
 * period of `report`. When `selectedPeriod.isFullRange` is true, the input
 * is returned unchanged.
 *
 * Notes:
 * - The deterministic `timestampMs` was constructed via `Date.UTC` from the
 *   parser's local time, so to compare against `selectedPeriod.fromIso`
 *   (which is also a local-ISO string built from UTC getters) we append
 *   "Z" before passing to `Date.parse`. This mirrors the convention used
 *   in `reportModel.ts` and `csvExport.ts` and round-trips cleanly.
 * - Returns a new array; never mutates the input.
 */
export function filterRowsToReportPeriod(
  rows: PressureRow[],
  report: ReportModel
): PressureRow[] {
  if (report.selectedPeriod.isFullRange) return rows;
  const lo = report.selectedPeriod.fromIso
    ? Date.parse(report.selectedPeriod.fromIso + 'Z')
    : Number.NEGATIVE_INFINITY;
  const hi = report.selectedPeriod.toIso
    ? Date.parse(report.selectedPeriod.toIso + 'Z')
    : Number.POSITIVE_INFINITY;
  return rows.filter((r) => r.timestampMs >= lo && r.timestampMs <= hi);
}

/**
 * Apply the PDF raw-data truncation rule:
 *
 *   - <= 1000 rows  → emit all rows verbatim
 *   - >  1000 rows  → emit first 500 + omission marker + last 500
 *
 * Returned shape lets the PDF renderer emit the marker between the two
 * halves without re-deriving the threshold.
 */
export interface RowTruncation {
  firstHalf: PressureRow[];
  /** null when no truncation; an array of the last 500 rows when truncated. */
  secondHalf: PressureRow[] | null;
  /** 0 when no truncation; otherwise rows.length - 1000. */
  omittedCount: number;
}

export const RAW_DATA_TRUNCATION_THRESHOLD = 1000;
export const RAW_DATA_TRUNCATION_HALF = 500;

export function applyRawDataTruncation(rows: PressureRow[]): RowTruncation {
  if (rows.length <= RAW_DATA_TRUNCATION_THRESHOLD) {
    return { firstHalf: rows, secondHalf: null, omittedCount: 0 };
  }
  return {
    firstHalf: rows.slice(0, RAW_DATA_TRUNCATION_HALF),
    secondHalf: rows.slice(rows.length - RAW_DATA_TRUNCATION_HALF),
    omittedCount: rows.length - RAW_DATA_TRUNCATION_HALF * 2
  };
}
