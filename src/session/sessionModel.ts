// sessionModel.ts — pure functions that move data between AppState and TestSession.
//
// No DOM, no fetch, no localStorage access. Storage I/O lives in
// sessionStorage.ts. Validation here is hand-rolled (no external schema lib)
// so the bundle stays small and we control every error message.

import type { DataSourceMode, ManualRow } from '../manual/manualTypes';
import { newManualRow } from '../manual/manualTypes';
import { createDefaultMetadata, type ReportMetadata } from '../reports/reportTypes';
import type { PressureChannel } from '../domain/types';
import {
  generateSessionId,
  SESSION_VERSION,
  type SessionParseResult,
  type SessionRestoreOutcome,
  type SessionValidationError,
  type TestSession,
  type TestSessionCriteria,
  type TestSessionSelectedPeriod,
  type TestSessionSourceSummary
} from './sessionTypes';

/** Inputs needed to materialise a TestSession from current AppState. */
export interface BuildSessionInput {
  sourceMode: DataSourceMode;
  sourceName: string | null;
  parsedRows: number | null;
  warnings: number | null;
  errors: number | null;
  selectedChannel: PressureChannel;
  selectedFromTimestampMs: number | null;
  selectedToTimestampMs: number | null;
  selectedFromTimeText: string;
  selectedToTimeText: string;
  maxDropPct: number;
  targetPressure: number | null;
  reportMetadata: ReportMetadata;
  manualRows: ManualRow[];
  /** Optional pre-existing session id and createdAt so autosave keeps a stable identity. */
  previousSessionId?: string;
  previousCreatedAtIso?: string;
}

/**
 * Build a TestSession from the supplied input. Always succeeds (the input
 * shape is constrained at the call site).
 */
export function buildTestSession(input: BuildSessionInput): TestSession {
  const now = new Date().toISOString();
  return {
    version: SESSION_VERSION,
    sessionId: input.previousSessionId ?? generateSessionId(),
    createdAtIso: input.previousCreatedAtIso ?? now,
    updatedAtIso: now,
    sourceMode: input.sourceMode,
    sourceSummary: {
      sourceName: input.sourceName,
      parsedRows: input.parsedRows,
      warnings: input.warnings,
      errors: input.errors
    },
    selectedChannel: input.selectedChannel,
    selectedPeriod: {
      fromTimestampMs: input.selectedFromTimestampMs,
      toTimestampMs: input.selectedToTimestampMs,
      fromTimeText: input.selectedFromTimeText,
      toTimeText: input.selectedToTimeText
    },
    criteria: {
      maxDropPct: input.maxDropPct,
      targetPressure: input.targetPressure
    },
    reportMetadata: { ...input.reportMetadata },
    manualRows: input.manualRows.map((r) => ({ ...r }))
  };
}

/**
 * Result of restoring AppState from a session — what the caller should do next.
 */
export interface RestoredFields {
  sourceMode: DataSourceMode;
  selectedChannel: PressureChannel;
  selectedFromTimestampMs: number | null;
  selectedToTimestampMs: number | null;
  selectedFromTimeText: string;
  selectedToTimeText: string;
  maxDropPct: number;
  targetPressure: number | null;
  reportMetadata: ReportMetadata;
  manualRows: ManualRow[];
  selectedFileName: string | null;
  sessionId: string;
  createdAtIso: string;
}

/**
 * Convert a TestSession back into the slice of AppState the renderer cares
 * about. The caller copies these fields into its own AppState and then runs
 * the existing `applyActiveSource(ctx)` pipeline to rebuild the analysis,
 * chart, and report previews.
 *
 * For file mode, `selectedFileName` is restored as a hint but no parse
 * result is produced — the operator must reselect the file.
 */
export function deriveRestoredFields(session: TestSession): RestoredFields {
  return {
    sourceMode: session.sourceMode,
    selectedChannel: session.selectedChannel,
    selectedFromTimestampMs: session.selectedPeriod.fromTimestampMs,
    selectedToTimestampMs: session.selectedPeriod.toTimestampMs,
    selectedFromTimeText: session.selectedPeriod.fromTimeText,
    selectedToTimeText: session.selectedPeriod.toTimeText,
    maxDropPct: session.criteria.maxDropPct ?? 5,
    targetPressure: session.criteria.targetPressure,
    reportMetadata: { ...session.reportMetadata },
    manualRows: session.manualRows.map((r) => ({ ...r })),
    selectedFileName: session.sourceSummary.sourceName,
    sessionId: session.sessionId,
    createdAtIso: session.createdAtIso
  };
}

/**
 * Decide what message + flags to surface to the UI after applying restored
 * fields. The caller will already have copied the fields into AppState.
 */
export function describeRestoreOutcome(session: TestSession): SessionRestoreOutcome {
  if (session.sourceMode === 'manual' && session.manualRows.length > 0) {
    return {
      kind: 'restored_manual',
      rebuiltManualParse: true,
      needsFileReselect: false,
      message: `Sist økt gjenopprettet med ${session.manualRows.length} manuelle rader.`
    };
  }
  if (session.sourceMode === 'file' && session.sourceSummary.sourceName) {
    return {
      kind: 'restored_file_needs_reselect',
      rebuiltManualParse: false,
      needsFileReselect: true,
      message: `Sist økt gjenopprettet (innstillinger). Velg "${session.sourceSummary.sourceName}" på nytt for å fortsette analysen.`
    };
  }
  return {
    kind: 'restored_empty',
    rebuiltManualParse: false,
    needsFileReselect: false,
    message: 'Sist økt gjenopprettet (ingen data lastet).'
  };
}

export function serializeTestSession(session: TestSession): string {
  return JSON.stringify(session, null, 2);
}

/**
 * Parse JSON text into a TestSession. Returns a discriminated union so the
 * caller can surface a precise error to the UI without try/catch.
 */
export function parseTestSessionJson(text: string): SessionParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: `Ugyldig JSON: ${err instanceof Error ? err.message : String(err)}`
      }
    };
  }
  return validateTestSession(value);
}

/**
 * Validate an arbitrary value as a TestSession. Hand-rolled — no schema lib.
 * Tolerates partially-typed inputs (e.g. `notes` field absent) but rejects
 * version mismatches, missing required keys, and structurally-wrong types.
 */
export function validateTestSession(value: unknown): SessionParseResult {
  if (!isPlainObject(value)) {
    return fail('NOT_AN_OBJECT', 'Forventet et JSON-objekt.');
  }

  const obj = value as Record<string, unknown>;

  if (obj['version'] !== SESSION_VERSION) {
    return fail(
      'INVALID_VERSION',
      `Ukjent session-versjon: ${JSON.stringify(obj['version'])}. Forventet ${SESSION_VERSION}.`,
      'version'
    );
  }

  const sessionId = requireString(obj, 'sessionId');
  if (!sessionId.ok) return { ok: false, error: sessionId.error };
  const createdAtIso = requireString(obj, 'createdAtIso');
  if (!createdAtIso.ok) return { ok: false, error: createdAtIso.error };
  const updatedAtIso = requireString(obj, 'updatedAtIso');
  if (!updatedAtIso.ok) return { ok: false, error: updatedAtIso.error };

  const sourceMode = obj['sourceMode'];
  if (sourceMode !== 'file' && sourceMode !== 'manual') {
    return fail('INVALID_SHAPE', 'sourceMode må være "file" eller "manual".', 'sourceMode');
  }

  const channelRaw = obj['selectedChannel'];
  if (channelRaw !== 'p1' && channelRaw !== 'p2') {
    return fail('INVALID_SHAPE', 'selectedChannel må være "p1" eller "p2".', 'selectedChannel');
  }

  const sourceSummary = parseSourceSummary(obj['sourceSummary']);
  if (!sourceSummary.ok) return { ok: false, error: sourceSummary.error };

  const selectedPeriod = parseSelectedPeriod(obj['selectedPeriod']);
  if (!selectedPeriod.ok) return { ok: false, error: selectedPeriod.error };

  const criteria = parseCriteria(obj['criteria']);
  if (!criteria.ok) return { ok: false, error: criteria.error };

  const reportMetadata = parseReportMetadata(obj['reportMetadata']);
  if (!reportMetadata.ok) return { ok: false, error: reportMetadata.error };

  const manualRows = parseManualRows(obj['manualRows']);
  if (!manualRows.ok) return { ok: false, error: manualRows.error };

  const notes = typeof obj['notes'] === 'string' ? (obj['notes'] as string) : undefined;

  const session: TestSession = {
    version: SESSION_VERSION,
    sessionId: sessionId.value,
    createdAtIso: createdAtIso.value,
    updatedAtIso: updatedAtIso.value,
    sourceMode,
    sourceSummary: sourceSummary.value,
    selectedChannel: channelRaw,
    selectedPeriod: selectedPeriod.value,
    criteria: criteria.value,
    reportMetadata: reportMetadata.value,
    manualRows: manualRows.value,
    ...(notes !== undefined ? { notes } : {})
  };

  return { ok: true, session };
}

// ---------- internal helpers ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(
  code: SessionValidationError['code'],
  message: string,
  field?: string
): { ok: false; error: SessionValidationError } {
  return { ok: false, error: { code, message, ...(field !== undefined ? { field } : {}) } };
}

type ParseFieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SessionValidationError };

function requireString(
  obj: Record<string, unknown>,
  key: string
): ParseFieldResult<string> {
  const v = obj[key];
  if (typeof v !== 'string') {
    return {
      ok: false,
      error: {
        code: 'INVALID_SHAPE',
        message: `Felt ${key} må være tekst.`,
        field: key
      }
    };
  }
  return { ok: true, value: v };
}

function parseSourceSummary(raw: unknown): ParseFieldResult<TestSessionSourceSummary> {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', message: 'sourceSummary må være et objekt.', field: 'sourceSummary' }
    };
  }
  return {
    ok: true,
    value: {
      sourceName: nullableString(raw['sourceName']),
      parsedRows: nullableNumber(raw['parsedRows']),
      warnings: nullableNumber(raw['warnings']),
      errors: nullableNumber(raw['errors'])
    }
  };
}

function parseSelectedPeriod(raw: unknown): ParseFieldResult<TestSessionSelectedPeriod> {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', message: 'selectedPeriod må være et objekt.', field: 'selectedPeriod' }
    };
  }
  return {
    ok: true,
    value: {
      fromTimestampMs: nullableNumber(raw['fromTimestampMs']),
      toTimestampMs: nullableNumber(raw['toTimestampMs']),
      fromTimeText: typeof raw['fromTimeText'] === 'string' ? (raw['fromTimeText'] as string) : '',
      toTimeText: typeof raw['toTimeText'] === 'string' ? (raw['toTimeText'] as string) : ''
    }
  };
}

function parseCriteria(raw: unknown): ParseFieldResult<TestSessionCriteria> {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', message: 'criteria må være et objekt.', field: 'criteria' }
    };
  }
  return {
    ok: true,
    value: {
      maxDropPct: nullableNumber(raw['maxDropPct']),
      targetPressure: nullableNumber(raw['targetPressure'])
    }
  };
}

function parseReportMetadata(raw: unknown): ParseFieldResult<ReportMetadata> {
  if (!isPlainObject(raw)) {
    // Tolerate missing — fall back to default empty metadata so an old
    // session without report fields still loads.
    return { ok: true, value: createDefaultMetadata() };
  }
  return {
    ok: true,
    value: {
      customerName: stringOrEmpty(raw['customerName']),
      projectNumber: stringOrEmpty(raw['projectNumber']),
      location: stringOrEmpty(raw['location']),
      testDate: stringOrEmpty(raw['testDate']),
      ihpuSerial: stringOrEmpty(raw['ihpuSerial']),
      rovSystem: stringOrEmpty(raw['rovSystem']),
      operatorName: stringOrEmpty(raw['operatorName']),
      comment: stringOrEmpty(raw['comment'])
    }
  };
}

function parseManualRows(raw: unknown): ParseFieldResult<ManualRow[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', message: 'manualRows må være en liste.', field: 'manualRows' }
    };
  }
  const out: ManualRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isPlainObject(r)) {
      return {
        ok: false,
        error: { code: 'CORRUPT_FIELD', message: `manualRows[${i}] må være et objekt.`, field: `manualRows[${i}]` }
      };
    }
    out.push(
      newManualRow({
        dateText: stringOrEmpty(r['dateText']),
        timeText: stringOrEmpty(r['timeText']),
        p1Text: stringOrEmpty(r['p1Text']),
        p2Text: stringOrEmpty(r['p2Text'])
      })
    );
  }
  return { ok: true, value: out };
}

function nullableString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return null;
  return null;
}

function nullableNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v === null || v === undefined) return null;
  return null;
}

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
