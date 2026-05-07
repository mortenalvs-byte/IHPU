import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import { calculatePressureDrop } from '../src/domain/pressureAnalysis';
import { buildReportModel, type BuildReportInput } from '../src/reports/reportModel';
import { createDefaultMetadata } from '../src/reports/reportTypes';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
const parsed = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });
const baseline = calculatePressureDrop(parsed.rows, 'p2');
const hold = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: 5 });

const baseInput = (): BuildReportInput => ({
  parseResult: parsed,
  baselineDrop: baseline,
  targetDrop: null,
  holdResult: hold,
  selectedChannel: 'p2',
  maxDropPct: 5,
  targetPressure: null,
  selectedFromTimestampMs: null,
  selectedToTimestampMs: null,
  selectedFromTimeText: '',
  selectedToTimeText: '',
  selectedFileName: 'Dekk test Seal T.2',
  reportMetadata: {
    ...createDefaultMetadata(),
    customerName: 'Test Customer AS',
    projectNumber: 'PRJ-001',
    location: 'Stavanger',
    testDate: '21.02.2026',
    ihpuSerial: 'IHPU-001',
    rovSystem: 'C24',
    operatorName: 'Morten',
    comment: 'Unit test fixture'
  }
});

describe('buildReportModel: canonical fixture', () => {
  it('builds a successful model with PASS hold', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.hold.status).toBe('PASS');
    expect(r.report.parser.parsedRows).toBe(461);
    expect(r.report.parser.errors).toBe(0);
  });

  it('echoes the metadata back unchanged', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.metadata.customerName).toBe('Test Customer AS');
    expect(r.report.metadata.projectNumber).toBe('PRJ-001');
    expect(r.report.metadata.location).toBe('Stavanger');
    expect(r.report.metadata.testDate).toBe('21.02.2026');
    expect(r.report.metadata.ihpuSerial).toBe('IHPU-001');
    expect(r.report.metadata.rovSystem).toBe('C24');
    expect(r.report.metadata.operatorName).toBe('Morten');
    expect(r.report.metadata.comment).toBe('Unit test fixture');
  });

  it('marks selected period as full range when no from/to set', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.selectedPeriod.isFullRange).toBe(true);
    expect(r.report.selectedPeriod.fromIso).toBeNull();
    expect(r.report.selectedPeriod.toIso).toBeNull();
    expect(r.report.selectedPeriod.durationMinutes).toBeCloseTo(69.4, 1);
  });

  it('preserves canonical p2 analysis numbers without re-deriving them', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.analysis.channel).toBe('p2');
    expect(r.report.analysis.startPressure).toBeCloseTo(314.386993, 6);
    expect(r.report.analysis.endPressure).toBeCloseTo(299.279053, 6);
    expect(r.report.analysis.dropBar).toBeCloseTo(15.107940, 6);
    expect(r.report.analysis.dropPctOfStart).toBeCloseTo(4.8055232361, 5);
    expect(r.report.analysis.barPerMinute).toBeCloseTo(0.21769, 4);
    expect(r.report.analysis.barPerHour).toBeCloseTo(13.0616, 3);
    expect(r.report.analysis.pressureIncreased).toBe(false);
  });

  it('produces ISO 8601 generatedAt and matches exact byte-for-byte input metadata', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.generatedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(r.report.sourceFileName).toBe('Dekk test Seal T.2');
  });

  it('reflects target pressure when set', () => {
    const targetDrop = calculatePressureDrop(parsed.rows, 'p2', { targetPressure: 315 });
    const input = baseInput();
    input.targetPressure = 315;
    input.targetDrop = targetDrop;
    const r = buildReportModel(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.criteria.targetPressure).toBe(315);
    expect(r.report.analysis.dropPctOfTarget).toBeCloseTo(4.7961714286, 5);
  });

  it('hold result echoes status, used/allowed/margin in percent points', () => {
    const r = buildReportModel(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.hold.status).toBe('PASS');
    expect(r.report.hold.usedDropPct).toBeCloseTo(4.8055, 3);
    expect(r.report.hold.allowedDropPct).toBe(5);
    expect(r.report.hold.marginPct).toBeCloseTo(0.1945, 3);
  });
});

describe('buildReportModel: error paths', () => {
  it('returns NO_FILE when no parseResult', () => {
    const r = buildReportModel({ ...baseInput(), parseResult: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NO_FILE');
  });

  it('returns NO_ANALYSIS when baselineDrop is null', () => {
    const r = buildReportModel({ ...baseInput(), baselineDrop: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NO_ANALYSIS');
  });

  it('returns NO_HOLD when holdResult is null', () => {
    const r = buildReportModel({ ...baseInput(), holdResult: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NO_HOLD');
  });
});

describe('buildReportModel: input integrity', () => {
  it('does not mutate the supplied metadata object', () => {
    const input = baseInput();
    const before = { ...input.reportMetadata };
    const r = buildReportModel(input);
    expect(r.ok).toBe(true);
    expect(input.reportMetadata).toEqual(before);
    if (!r.ok) return;
    // The model owns its own copy, so future input mutations should not bleed in.
    input.reportMetadata.customerName = 'Mutated';
    expect(r.report.metadata.customerName).toBe('Test Customer AS');
  });

  it('respects selected period bounds in the model', () => {
    const input = baseInput();
    input.selectedFromTimestampMs = parsed.rows[0]!.timestampMs;
    input.selectedToTimestampMs = parsed.rows[10]!.timestampMs;
    input.selectedFromTimeText = '13:10:37';
    input.selectedToTimeText = '13:11:43';
    const r = buildReportModel(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.selectedPeriod.isFullRange).toBe(false);
    expect(r.report.selectedPeriod.fromIso).toBe('2026-02-21T13:10:37');
    expect(r.report.selectedPeriod.fromText).toBe('13:10:37');
    expect(r.report.selectedPeriod.toText).toBe('13:11:43');
  });
});
