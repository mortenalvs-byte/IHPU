// Domain types for IHPU pressure log parsing and downstream analysis.
//
// This module is part of the pure domain layer. It must not import the DOM,
// Electron, Chart.js, jsPDF, or any browser-only API. Everything here must work
// equally well inside a browser bundle, an Electron renderer, and a Node-based
// Vitest test.

export type PressureChannel = 'p1' | 'p2';

export type ParseSeverity = 'warning' | 'error';

export type ParseIssueCode =
  | 'EMPTY_INPUT'
  | 'MALFORMED_LINE'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_NUMBER'
  | 'MISSING_VALUE'
  | 'EXTRA_COLUMNS'
  | 'UNSORTED_INPUT'
  | 'NO_VALID_ROWS';

export interface ParseIssue {
  severity: ParseSeverity;
  code: ParseIssueCode;
  /** 1-based source line number. 0 means "applies to whole input, not a single line". */
  line: number;
  /** Optional 1-based column index inside the offending line. */
  column?: number;
  /** Logical field name when the issue is field-specific (e.g. 'p1', 'p2', 'timestamp'). */
  field?: string;
  message: string;
  raw?: string;
}

export interface PressureRow {
  /** 0-based index in the final, sorted `rows` array. */
  index: number;
  /** 1-based line number in the original input. */
  sourceLine: number;
  /** Original line text, untouched. */
  raw: string;
  /** Date portion as it appeared in the source (e.g. '21.02.2026'). */
  dateText: string;
  /** Time portion as it appeared in the source (e.g. '13:10:37'). */
  timeText: string;
  /**
   * Local-time ISO-8601 string built from the parsed date/time parts. No timezone
   * suffix because IHPU log timestamps carry no timezone information.
   */
  localIso: string;
  /**
   * Deterministic timestamp key created with Date.UTC from the local log timestamp.
   * This is not a timezone conversion. It is a stable ordering/duration key for
   * timezone-less IHPU log timestamps.
   */
  timestampMs: number;
  /**
   * Minutes from first valid parsed row. Always 0 for the first row.
   */
  tMinutes: number;
  /**
   * T1 and T2 raw numeric pressure values.
   * Null means missing/invalid in source row.
   * Negative values are valid numeric raw values and must be preserved.
   */
  p1: number | null;
  p2: number | null;
}

export interface ChannelPresence {
  p1: boolean;
  p2: boolean;
}

export interface ChannelStats {
  count: number;
  nullCount: number;
  min: number | null;
  max: number | null;
  first: number | null;
  last: number | null;
}

export interface ParseMeta {
  sourceName?: string;
  /** Line count after splitting input on /\r?\n/, including any trailing empty line. */
  totalLines: number;
  /** Lines whose trimmed content was non-empty. */
  nonEmptyLines: number;
  /** Number of PressureRow entries returned in `rows`. */
  parsedRows: number;
  /** Non-empty lines that could not become a PressureRow (typically INVALID_TIMESTAMP or MALFORMED_LINE). */
  skippedLines: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  durationMinutes: number | null;
  channelsPresent: ChannelPresence;
  channelStats: {
    p1: ChannelStats;
    p2: ChannelStats;
  };
}

export interface ParseResult {
  rows: PressureRow[];
  /** Combined warnings + errors in source order. */
  issues: ParseIssue[];
  warnings: ParseIssue[];
  errors: ParseIssue[];
  meta: ParseMeta;
}

export interface ParseOptions {
  sourceName?: string;
  /** Default true. When false, rows are emitted in source order (UNSORTED_INPUT warning still added if applicable). */
  sortRows?: boolean;
}
