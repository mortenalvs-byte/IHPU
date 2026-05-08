import { describe, expect, it } from 'vitest';
import { newManualRow } from '../src/manual/manualTypes';
import { createDefaultMetadata } from '../src/reports/reportTypes';
import {
  buildTestSession,
  deriveRestoredFields,
  describeRestoreOutcome,
  parseTestSessionJson,
  serializeTestSession,
  validateTestSession
} from '../src/session/sessionModel';
import { SESSION_VERSION, type TestSession } from '../src/session/sessionTypes';

function manualSessionInput() {
  return {
    sourceMode: 'manual' as const,
    sourceName: 'Manual entry',
    parsedRows: 3,
    warnings: 0,
    errors: 0,
    selectedChannel: 'p2' as const,
    selectedFromTimestampMs: null,
    selectedToTimestampMs: null,
    selectedFromTimeText: '',
    selectedToTimeText: '',
    maxDropPct: 5,
    targetPressure: 315,
    reportMetadata: {
      ...createDefaultMetadata(),
      customerName: 'Test Customer AS',
      projectNumber: 'PRJ-001',
      operatorName: 'Morten'
    },
    manualRows: [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '-2.96', p2Text: '320' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:30:00', p1Text: '-2.95', p2Text: '305' })
    ]
  };
}

function fileSessionInput() {
  return {
    sourceMode: 'file' as const,
    sourceName: 'Dekk test Seal T.2',
    parsedRows: 461,
    warnings: 0,
    errors: 0,
    selectedChannel: 'p2' as const,
    selectedFromTimestampMs: 1234,
    selectedToTimestampMs: 5678,
    selectedFromTimeText: '13:10:37',
    selectedToTimeText: '14:20:01',
    maxDropPct: 5,
    targetPressure: null,
    reportMetadata: createDefaultMetadata(),
    manualRows: []
  };
}

describe('buildTestSession', () => {
  it('builds a session from manual-mode input', () => {
    const s = buildTestSession(manualSessionInput());
    expect(s.version).toBe(SESSION_VERSION);
    expect(s.sourceMode).toBe('manual');
    expect(s.manualRows).toHaveLength(2);
    expect(s.criteria.maxDropPct).toBe(5);
    expect(s.criteria.targetPressure).toBe(315);
    expect(s.reportMetadata.customerName).toBe('Test Customer AS');
  });

  it('builds a session from file-mode input WITHOUT raw text', () => {
    const s = buildTestSession(fileSessionInput());
    expect(s.sourceMode).toBe('file');
    expect(s.sourceSummary.sourceName).toBe('Dekk test Seal T.2');
    expect(s.sourceSummary.parsedRows).toBe(461);
    expect(s.manualRows).toHaveLength(0);
    expect(JSON.stringify(s)).not.toContain('314.386993');
  });

  it('preserves selected channel, period, criteria, and metadata', () => {
    const s = buildTestSession(fileSessionInput());
    expect(s.selectedChannel).toBe('p2');
    expect(s.selectedPeriod.fromTimestampMs).toBe(1234);
    expect(s.selectedPeriod.toTimestampMs).toBe(5678);
    expect(s.selectedPeriod.fromTimeText).toBe('13:10:37');
    expect(s.selectedPeriod.toTimeText).toBe('14:20:01');
  });

  it('reuses previousSessionId and previousCreatedAtIso when supplied', () => {
    const first = buildTestSession(manualSessionInput());
    const second = buildTestSession({
      ...manualSessionInput(),
      previousSessionId: first.sessionId,
      previousCreatedAtIso: first.createdAtIso
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.createdAtIso).toBe(first.createdAtIso);
    // updatedAtIso may differ
  });

  it('does not mutate the supplied input', () => {
    const input = manualSessionInput();
    const before = JSON.stringify(input);
    buildTestSession(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('serialize/parse roundtrip', () => {
  it('round-trips a manual session through JSON', () => {
    const session = buildTestSession(manualSessionInput());
    const text = serializeTestSession(session);
    const parsed = parseTestSessionJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.sessionId).toBe(session.sessionId);
    expect(parsed.session.manualRows).toHaveLength(2);
    expect(parsed.session.criteria.targetPressure).toBe(315);
  });

  it('round-trips a file session through JSON', () => {
    const session = buildTestSession(fileSessionInput());
    const text = serializeTestSession(session);
    const parsed = parseTestSessionJson(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.sourceSummary.sourceName).toBe('Dekk test Seal T.2');
    expect(parsed.session.manualRows).toHaveLength(0);
  });
});

describe('parseTestSessionJson / validateTestSession: error paths', () => {
  it('rejects malformed JSON', () => {
    const r = parseTestSessionJson('{"not really json');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_JSON');
  });

  it('rejects non-object payloads', () => {
    const r = parseTestSessionJson('"a string"');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_AN_OBJECT');
  });

  it('rejects mismatched version', () => {
    const r = parseTestSessionJson('{"version": 99}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_VERSION');
    expect(r.error.field).toBe('version');
  });

  it('rejects bad sourceMode', () => {
    const session = buildTestSession(manualSessionInput()) as unknown as Record<string, unknown>;
    session['sourceMode'] = 'cloud';
    const r = validateTestSession(session);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.field).toBe('sourceMode');
  });

  it('rejects bad selectedChannel', () => {
    const session = buildTestSession(manualSessionInput()) as unknown as Record<string, unknown>;
    session['selectedChannel'] = 'p3';
    const r = validateTestSession(session);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.field).toBe('selectedChannel');
  });

  it('rejects manualRows being non-array', () => {
    const session = buildTestSession(manualSessionInput()) as unknown as Record<string, unknown>;
    session['manualRows'] = 'oops';
    const r = validateTestSession(session);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.field).toBe('manualRows');
  });

  it('tolerates missing reportMetadata by using defaults', () => {
    const session = buildTestSession(manualSessionInput()) as unknown as Record<string, unknown>;
    delete session['reportMetadata'];
    const r = validateTestSession(session);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.reportMetadata.customerName).toBe('');
  });
});

describe('deriveRestoredFields', () => {
  it('exposes all UI-relevant fields from a session', () => {
    const session = buildTestSession(manualSessionInput());
    const fields = deriveRestoredFields(session);
    expect(fields.sourceMode).toBe('manual');
    expect(fields.selectedChannel).toBe('p2');
    expect(fields.maxDropPct).toBe(5);
    expect(fields.targetPressure).toBe(315);
    expect(fields.manualRows).toHaveLength(2);
    expect(fields.reportMetadata.customerName).toBe('Test Customer AS');
    expect(fields.selectedFileName).toBe('Manual entry');
  });

  it('falls back maxDropPct to 5 when criteria.maxDropPct is null', () => {
    const session: TestSession = buildTestSession(manualSessionInput());
    session.criteria.maxDropPct = null;
    const fields = deriveRestoredFields(session);
    expect(fields.maxDropPct).toBe(5);
  });

  it('returns independent copies of metadata and rows (no mutation aliasing)', () => {
    const session = buildTestSession(manualSessionInput());
    const fields = deriveRestoredFields(session);
    fields.reportMetadata.customerName = 'Mutated';
    fields.manualRows[0]!.p1Text = 'mutated';
    expect(session.reportMetadata.customerName).toBe('Test Customer AS');
    expect(session.manualRows[0]!.p1Text).toBe('-2.96');
  });
});

describe('describeRestoreOutcome', () => {
  it('marks manual sessions as restored_manual', () => {
    const session = buildTestSession(manualSessionInput());
    const outcome = describeRestoreOutcome(session);
    expect(outcome.kind).toBe('restored_manual');
    expect(outcome.rebuiltManualParse).toBe(true);
    expect(outcome.needsFileReselect).toBe(false);
  });

  it('marks file sessions as needing reselect', () => {
    const session = buildTestSession(fileSessionInput());
    const outcome = describeRestoreOutcome(session);
    expect(outcome.kind).toBe('restored_file_needs_reselect');
    expect(outcome.needsFileReselect).toBe(true);
    expect(outcome.message).toContain('Dekk test Seal T.2');
  });

  it('marks empty sessions as restored_empty', () => {
    const session = buildTestSession({ ...manualSessionInput(), manualRows: [] });
    const outcome = describeRestoreOutcome(session);
    expect(outcome.kind).toBe('restored_empty');
    expect(outcome.rebuiltManualParse).toBe(false);
    expect(outcome.needsFileReselect).toBe(false);
  });
});
