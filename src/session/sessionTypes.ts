// Test-session types — the data contract for autosave, export, and import.
//
// A `TestSession` is an explicit snapshot of operator-facing app state that
// is safe to persist and re-load. It deliberately does NOT include the
// uploaded raw file content. File mode round-trips via `sourceSummary` only;
// after a restart the operator must reselect the source file. Manual rows
// round-trip in full (they originated as operator input anyway).

import type { DataSourceMode, ManualRow } from '../manual/manualTypes';
import type { ReportMetadata } from '../reports/reportTypes';
import type { PressureChannel } from '../domain/types';

/** Bumped only when the on-disk shape changes incompatibly. */
export const SESSION_VERSION = 1;

/** localStorage key used for the persistent autosave slot. */
export const SESSION_STORAGE_KEY = 'ihpu.testSession.v1';

export interface TestSessionSourceSummary {
  /** Filename of the last loaded log, or 'Manual entry' for manual mode. */
  sourceName: string | null;
  /** Echo of `parseResult.meta.parsedRows` so the UI can hint at restored size before parse. */
  parsedRows: number | null;
  warnings: number | null;
  errors: number | null;
}

export interface TestSessionSelectedPeriod {
  fromTimestampMs: number | null;
  toTimestampMs: number | null;
  fromTimeText: string;
  toTimeText: string;
}

export interface TestSessionCriteria {
  maxDropPct: number | null;
  targetPressure: number | null;
}

export interface TestSession {
  version: typeof SESSION_VERSION;
  /** Stable identifier for this session — useful when correlating exports. */
  sessionId: string;
  createdAtIso: string;
  updatedAtIso: string;
  sourceMode: DataSourceMode;
  sourceSummary: TestSessionSourceSummary;
  selectedChannel: PressureChannel;
  selectedPeriod: TestSessionSelectedPeriod;
  criteria: TestSessionCriteria;
  reportMetadata: ReportMetadata;
  manualRows: ManualRow[];
  notes?: string;
}

export type SessionValidationErrorCode =
  | 'INVALID_JSON'
  | 'NOT_AN_OBJECT'
  | 'INVALID_VERSION'
  | 'INVALID_SHAPE'
  | 'CORRUPT_FIELD';

export interface SessionValidationError {
  code: SessionValidationErrorCode;
  message: string;
  /** Field path where the failure happened (when applicable). */
  field?: string;
}

export type SessionParseResult =
  | { ok: true; session: TestSession }
  | { ok: false; error: SessionValidationError };

export type SessionLoadResult =
  | { ok: true; session: TestSession }
  | { ok: false; reason: 'NOT_FOUND' | 'STORAGE_UNAVAILABLE'; message: string }
  | { ok: false; reason: 'INVALID'; error: SessionValidationError };

export type SessionRestoreOutcomeKind =
  | 'restored_manual'
  | 'restored_file_needs_reselect'
  | 'restored_empty'
  | 'no_session'
  | 'failed';

export interface SessionRestoreOutcome {
  kind: SessionRestoreOutcomeKind;
  /** Human-readable message suitable for the session-status UI field. */
  message: string;
  /** Whether the manual rows were rehydrated (and the analysis pipeline should re-run). */
  rebuiltManualParse: boolean;
  /** Whether the operator needs to reselect a source file to continue analysis. */
  needsFileReselect: boolean;
}

export function generateSessionId(): string {
  // Date-prefixed monotonic counter — stable enough; not crypto-grade. We
  // reuse this id across exports so a customer report can be correlated
  // with the session JSON that produced it.
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
