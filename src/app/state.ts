// AppState — the single source of truth for the renderer.
//
// State is intentionally a plain mutable object. Updates happen in events.ts;
// render.ts reads from state and pushes textContent into the DOM. No reducers,
// no observables, no framework — for a small Electron app this is enough.

import type {
  DataSourceMode,
  ManualRow,
  ManualValidationResult
} from '../manual/manualTypes';
import { createDefaultMetadata, type ReportMetadata } from '../reports/reportTypes';
import type {
  HoldPeriodResult,
  ParseResult,
  PressureChannel,
  PressureDropResult
} from '../domain/types';

export type AppMessageSeverity = 'info' | 'warning' | 'error';

export interface AppMessage {
  severity: AppMessageSeverity;
  text: string;
}

export interface AppState {
  selectedFileName: string | null;
  parseResult: ParseResult | null;
  selectedChannel: PressureChannel;
  /** maxDropPct in PERCENT POINTS. UI input default = 5 (= 5 %). */
  maxDropPct: number;
  /** targetPressure in bar; null when the user has not specified one. */
  targetPressure: number | null;
  /**
   * Operator-selected analysis range. Both null means "use the full parsed
   * range" (default after upload). Applied to calculatePressureDrop /
   * evaluateHoldPeriod, and visualised in the chart.
   */
  selectedFromTimestampMs: number | null;
  selectedToTimestampMs: number | null;
  /**
   * Raw text the user typed in the period-from / period-to inputs. Kept
   * separate from the timestamp values so partially-typed or invalid input
   * doesn't trash the active range.
   */
  selectedFromTimeText: string;
  selectedToTimeText: string;
  /** True once a Chart.js instance has been mounted with data. */
  chartReady: boolean;
  /** Last chart-related error message (e.g. parse-time-text failure). Null when fine. */
  chartError: string | null;
  /** PressureDropResult with reference = startPressure (always populated when rows exist). */
  baselineDrop: PressureDropResult | null;
  /** PressureDropResult with reference = targetPressure (only when targetPressure is set). */
  targetDrop: PressureDropResult | null;
  /** Hold-period evaluation using current targetPressure and maxDropPct. */
  holdResult: HoldPeriodResult | null;
  /** Last user-facing message (file read failure, etc.). Cleared on next file load. */
  userMessage: AppMessage | null;
  /** Editable report metadata (customer/project/operator/comment/etc.). Empty strings by default. */
  reportMetadata: ReportMetadata;
  /** Export attempt status, surfaced in the UI's `export-status` field. */
  exportStatus: ExportStatus;
  /**
   * Active data source. `file` (default) means `parseResult` came from a
   * file upload; `manual` means it was built from `manualRows`. The toggle
   * only swaps which source feeds the analysis pipeline — both inputs
   * remain in state so the operator can switch back and forth.
   */
  sourceMode: DataSourceMode;
  /** Last successfully-parsed file ParseResult. Kept across `manual` mode so file→manual→file works without re-uploading. */
  fileParseResult: ParseResult | null;
  /** Operator-edited manual rows (raw strings until validated). */
  manualRows: ManualRow[];
  /** Live validation summary of manualRows. Recomputed on every edit. */
  manualValidation: ManualValidationResult | null;
}

export type ExportStatusKind = 'idle' | 'success' | 'error';

export interface ExportStatus {
  kind: ExportStatusKind;
  message: string;
}

export const DEFAULT_CHANNEL: PressureChannel = 'p2';
export const DEFAULT_MAX_DROP_PCT = 5;

export function createState(): AppState {
  return {
    selectedFileName: null,
    parseResult: null,
    selectedChannel: DEFAULT_CHANNEL,
    maxDropPct: DEFAULT_MAX_DROP_PCT,
    targetPressure: null,
    selectedFromTimestampMs: null,
    selectedToTimestampMs: null,
    selectedFromTimeText: '',
    selectedToTimeText: '',
    chartReady: false,
    chartError: null,
    baselineDrop: null,
    targetDrop: null,
    holdResult: null,
    userMessage: null,
    reportMetadata: createDefaultMetadata(),
    exportStatus: { kind: 'idle', message: '' },
    sourceMode: 'file',
    fileParseResult: null,
    manualRows: [],
    manualValidation: null
  };
}
