// Types for the manual data-entry channel.
//
// Manual entry must NOT introduce a parallel analysis path. The end product
// of validation is a `PressureRow[]` (and a parser-shaped summary) that
// flows into the same `calculatePressureDrop` / `evaluateHoldPeriod` /
// chart / CSV / PDF pipeline as file-uploaded data.

export type DataSourceMode = 'file' | 'manual';

/**
 * Raw manual-entry row as the operator typed it. Strings deliberately so
 * partial / mid-edit input doesn't get coerced or lost. Validation runs over
 * these strings and produces issues; conversion to PressureRow happens later
 * in `manualRows.ts`.
 */
export interface ManualRow {
  /** Stable id used to reference rows from delete buttons across re-renders. */
  id: string;
  /** Date in `DD.MM.YYYY` or `YYYY-MM-DD`. */
  dateText: string;
  /** Time in `HH:MM` or `HH:MM:SS`. */
  timeText: string;
  /** T1 pressure as the operator typed it. Empty allowed if T2 is supplied. */
  p1Text: string;
  /** T2 pressure as the operator typed it. Empty allowed if T1 is supplied. */
  p2Text: string;
}

export type ManualIssueSeverity = 'error' | 'warning';

export type ManualIssueCode =
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'INVALID_NUMBER'
  | 'NO_CHANNELS'
  | 'EMPTY_ROW'
  | 'DUPLICATE_TIMESTAMP'
  | 'UNSORTED'
  | 'NO_VALID_ROWS';

export interface ManualIssue {
  severity: ManualIssueSeverity;
  code: ManualIssueCode;
  /** 1-based row index in the operator's manual list. 0 means whole-collection. */
  rowIndex: number;
  /** Stable id of the offending row (empty when whole-collection). */
  rowId: string;
  /** Field name when the issue is field-specific. */
  field?: 'date' | 'time' | 'p1' | 'p2';
  message: string;
}

export interface ManualValidationResult {
  /** Number of rows that passed all per-row validation (date+time+at-least-one channel valid). */
  validRowCount: number;
  /** Total number of rows in the operator's collection. */
  totalRowCount: number;
  errors: ManualIssue[];
  warnings: ManualIssue[];
  issues: ManualIssue[];
}

export interface ManualPasteOutcome {
  /** Newly-built ManualRow objects ready to append to state.manualRows. */
  rows: ManualRow[];
  /** Validation issues detected during paste (per-line). */
  issues: ManualIssue[];
  /** Number of pasted lines that produced a row. */
  imported: number;
  /** Number of pasted lines that were rejected. */
  rejected: number;
}

export function newManualRow(seed: Partial<Omit<ManualRow, 'id'>> = {}): ManualRow {
  return {
    id: generateRowId(),
    dateText: seed.dateText ?? '',
    timeText: seed.timeText ?? '',
    p1Text: seed.p1Text ?? '',
    p2Text: seed.p2Text ?? ''
  };
}

let _rowIdCounter = 0;
export function generateRowId(): string {
  _rowIdCounter += 1;
  // Date-prefixed plus monotonic counter — stable enough for UI keys, no
  // need for crypto-grade uniqueness.
  return `mr_${Date.now().toString(36)}_${_rowIdCounter.toString(36)}`;
}

/** Reset internal counter — used only by tests for deterministic ids. */
export function _resetRowIdCounterForTests(): void {
  _rowIdCounter = 0;
}
