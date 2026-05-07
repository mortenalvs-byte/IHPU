import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import { calculatePressureDrop } from '../src/domain/pressureAnalysis';
import { buildReportCsv, buildSafeReportFilename } from '../src/reports/csvExport';
import { buildReportModel } from '../src/reports/reportModel';
import { createDefaultMetadata, type ReportModel } from '../src/reports/reportTypes';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
const parsed = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });
const baseline = calculatePressureDrop(parsed.rows, 'p2');
const hold = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: 5 });

function reportFor(overrides: Partial<{ customer: string; project: string; comment: string }> = {}): ReportModel {
  const md = {
    ...createDefaultMetadata(),
    customerName: overrides.customer ?? 'Test Customer AS',
    projectNumber: overrides.project ?? 'PRJ-001',
    location: 'Stavanger',
    testDate: '21.02.2026',
    ihpuSerial: 'IHPU-001',
    rovSystem: 'C24',
    operatorName: 'Morten',
    comment: overrides.comment ?? 'Smoke fixture'
  };
  const built = buildReportModel({
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
    reportMetadata: md
  });
  if (!built.ok) throw new Error('Test setup: report build failed');
  return built.report;
}

describe('buildReportCsv', () => {
  it('includes metadata, parser summary, period, analysis, hold, and rows', () => {
    const csv = buildReportCsv(reportFor(), parsed.rows);
    expect(csv).toContain('Test Customer AS');
    expect(csv).toContain('PRJ-001');
    expect(csv).toContain('Stavanger');
    expect(csv).toContain('21.02.2026');
    expect(csv).toContain('IHPU-001');
    expect(csv).toContain('parsedRows,461');
    expect(csv).toContain('isFullRange,true');
    expect(csv).toContain('channel,p2');
    expect(csv).toContain('status,PASS');
  });

  it('uses CRLF line endings', () => {
    const csv = buildReportCsv(reportFor(), parsed.rows);
    expect(csv).toContain('\r\n');
    // No bare LF without preceding CR
    const bareLf = csv.split('').filter((ch, i, arr) => ch === '\n' && arr[i - 1] !== '\r').length;
    expect(bareLf).toBe(0);
  });

  it('emits machine-readable numeric values (period decimal, no thousand separators)', () => {
    const csv = buildReportCsv(reportFor(), parsed.rows);
    // Some canonical numeric markers must appear with period decimal.
    expect(csv).toMatch(/dropBar,15\.10794/);
    expect(csv).toMatch(/dropPctOfStart,4\.8055/);
    expect(csv).toMatch(/durationMinutes,69\.4\d*/);
    // Norwegian decimal comma must NOT appear in numeric fields.
    expect(csv).not.toMatch(/dropBar,15,10794/);
  });

  it('escapes quotes, commas, and newlines safely', () => {
    const tricky = reportFor({
      customer: 'Strange "Customer", Inc.',
      comment: 'multi\nline,with comma'
    });
    const csv = buildReportCsv(tricky, parsed.rows);
    // Original double-quotes are doubled; field is wrapped in quotes.
    expect(csv).toContain('"Strange ""Customer"", Inc."');
    expect(csv).toContain('"multi\nline,with comma"');
  });

  it('includes p2 row data with canonical first-row values', () => {
    const csv = buildReportCsv(reportFor(), parsed.rows);
    expect(csv).toContain('# Rader');
    expect(csv).toContain('index,sourceLine,localIso,tMinutes,p1,p2');
    // First parsed row: 21.02.2026 13:10:37, p1=-2.958707, p2=314.386993
    expect(csv).toContain('2026-02-21T13:10:37');
    expect(csv).toContain('-2.958707');
    expect(csv).toContain('314.386993');
  });

  it('includes UNKNOWN status when criteria missing', () => {
    const unknownHold = evaluateHoldPeriod(parsed.rows, 'p2', {});
    const built = buildReportModel({
      parseResult: parsed,
      baselineDrop: baseline,
      targetDrop: null,
      holdResult: unknownHold,
      selectedChannel: 'p2',
      maxDropPct: 5,
      targetPressure: null,
      selectedFromTimestampMs: null,
      selectedToTimestampMs: null,
      selectedFromTimeText: '',
      selectedToTimeText: '',
      selectedFileName: 'Dekk test Seal T.2',
      reportMetadata: createDefaultMetadata()
    });
    if (!built.ok) throw new Error('Test setup failed');
    const csv = buildReportCsv(built.report, parsed.rows);
    expect(csv).toContain('status,UNKNOWN');
  });
});

describe('buildSafeReportFilename', () => {
  it('uses project + date + status when project metadata is supplied', () => {
    const r = reportFor();
    const csvName = buildSafeReportFilename(r, 'csv');
    expect(csvName).toMatch(/^IHPU_PRJ-001_21\.02\.2026_PASS\.csv$/);
    const pdfName = buildSafeReportFilename(r, 'pdf');
    expect(pdfName).toMatch(/^IHPU_PRJ-001_21\.02\.2026_PASS\.pdf$/);
  });

  it('falls back to a timestamp-based name when project metadata is empty', () => {
    const r = reportFor();
    r.metadata.projectNumber = '';
    r.metadata.testDate = '';
    const name = buildSafeReportFilename(r, 'csv');
    expect(name).toMatch(/^IHPU_report_\d{8}-\d{6}\.csv$/);
  });

  it('sanitises filesystem-unsafe characters in metadata', () => {
    const r = reportFor({ project: 'Bad/Name:With"Stuff*' });
    const name = buildSafeReportFilename(r, 'csv');
    // No raw forbidden characters in the resulting filename.
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name).toContain('Bad_Name_With_Stuff');
  });
});
