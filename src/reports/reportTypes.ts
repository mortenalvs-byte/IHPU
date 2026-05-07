// Report / export types.
//
// Pure data shapes used by csvExport, pdfReport, and the UI bridge.
// The ReportModel is the single source of truth for a generated report — once
// built, both CSV and PDF read from the same object so they cannot disagree.

import type { PressureChannel } from '../domain/types';

export interface ReportMetadata {
  customerName: string;
  projectNumber: string;
  location: string;
  /** Free-form text. Operator types whatever date format they prefer (DD.MM.YYYY in Norway). */
  testDate: string;
  ihpuSerial: string;
  rovSystem: string;
  operatorName: string;
  comment: string;
}

export interface ReportSelectedPeriod {
  /** Local ISO of the range start. Null when the operator hasn't picked a from-time. */
  fromIso: string | null;
  toIso: string | null;
  /** Raw input text (HH:MM:SS form) — useful for echoing back what the operator typed. */
  fromText: string;
  toText: string;
  /** Duration of the analyzed range, in minutes. */
  durationMinutes: number | null;
  /** True when neither from nor to was set, i.e. analysis ran on the full parsed range. */
  isFullRange: boolean;
}

export interface ReportParserSummary {
  parsedRows: number;
  warnings: number;
  errors: number;
  /** Wall-clock first/last timestamps of the parsed log (NOT the selected period). */
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  durationMinutes: number | null;
}

export interface ReportAnalysis {
  channel: PressureChannel;
  startPressure: number | null;
  endPressure: number | null;
  dropBar: number | null;
  /** dropPct against startPressure as reference. Always present when analysis succeeded. */
  dropPctOfStart: number | null;
  /** dropPct against operator-supplied targetPressure. Null when no target was set. */
  dropPctOfTarget: number | null;
  barPerMinute: number | null;
  barPerHour: number | null;
  /** True when dropBar < 0 (pressure increased over the analyzed range). */
  pressureIncreased: boolean | null;
}

export interface ReportCriteria {
  /** Maximum allowed drop, percent points (e.g. 5 means 5 %). */
  maxDropPct: number;
  /** Operator-supplied target pressure, null when not set. */
  targetPressure: number | null;
  /** Reference pressure actually used for dropPct in the hold evaluation. */
  referencePressure: number | null;
}

export interface ReportHold {
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  usedDropPct: number | null;
  allowedDropPct: number;
  marginPct: number | null;
  /** Compact string list of issues from the hold-period evaluation. */
  warnings: string[];
  errors: string[];
}

export interface ReportModel {
  /** ISO-8601 UTC timestamp captured when the report was built. */
  generatedAtIso: string;
  /** Original filename of the loaded log. Empty string when no file. */
  sourceFileName: string;
  parser: ReportParserSummary;
  selectedPeriod: ReportSelectedPeriod;
  analysis: ReportAnalysis;
  criteria: ReportCriteria;
  hold: ReportHold;
  metadata: ReportMetadata;
}

export type ReportBuildErrorCode = 'NO_FILE' | 'NO_ROWS' | 'NO_ANALYSIS' | 'NO_HOLD';

export interface ReportBuildError {
  code: ReportBuildErrorCode;
  message: string;
}

export type ReportBuildResult =
  | { ok: true; report: ReportModel }
  | { ok: false; error: ReportBuildError };

export function createDefaultMetadata(): ReportMetadata {
  return {
    customerName: '',
    projectNumber: '',
    location: '',
    testDate: '',
    ihpuSerial: '',
    rovSystem: '',
    operatorName: '',
    comment: ''
  };
}
