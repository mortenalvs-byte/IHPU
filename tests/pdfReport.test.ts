import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import { calculatePressureDrop } from '../src/domain/pressureAnalysis';
import { buildCustomerReportPdf } from '../src/reports/pdfReport';
import { buildReportModel } from '../src/reports/reportModel';
import { createDefaultMetadata, type ReportModel } from '../src/reports/reportTypes';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
const parsed = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });
const baseline = calculatePressureDrop(parsed.rows, 'p2');

function reportWithHold(maxDropPct: number | undefined = 5): ReportModel {
  const hold = evaluateHoldPeriod(parsed.rows, 'p2', maxDropPct === undefined ? {} : { maxDropPct });
  const built = buildReportModel({
    parseResult: parsed,
    baselineDrop: baseline,
    targetDrop: null,
    holdResult: hold,
    selectedChannel: 'p2',
    maxDropPct: maxDropPct ?? 0,
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
      operatorName: 'Morten',
      comment: 'Smoke test report'
    }
  });
  if (!built.ok) throw new Error('Test setup: report build failed');
  return built.report;
}

const PDF_MAGIC = '%PDF-';

describe('buildCustomerReportPdf', () => {
  it('returns a non-empty ArrayBuffer with PDF magic bytes', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5));
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(1000);

    const head = new TextDecoder('utf-8').decode(new Uint8Array(buffer.slice(0, 8)));
    expect(head.startsWith(PDF_MAGIC)).toBe(true);
  });

  it('handles PASS status without throwing', () => {
    expect(() => buildCustomerReportPdf(reportWithHold(5))).not.toThrow();
  });

  it('handles FAIL status without throwing', () => {
    expect(() => buildCustomerReportPdf(reportWithHold(1))).not.toThrow();
  });

  it('handles UNKNOWN status without throwing', () => {
    expect(() => buildCustomerReportPdf(reportWithHold(undefined))).not.toThrow();
  });

  it('handles missing optional metadata without throwing', () => {
    const r = reportWithHold(5);
    r.metadata.customerName = '';
    r.metadata.projectNumber = '';
    r.metadata.location = '';
    r.metadata.testDate = '';
    r.metadata.ihpuSerial = '';
    r.metadata.rovSystem = '';
    r.metadata.operatorName = '';
    r.metadata.comment = '';
    expect(() => buildCustomerReportPdf(r)).not.toThrow();
  });

  it('handles a long comment without crashing (line wrapping)', () => {
    const r = reportWithHold(5);
    r.metadata.comment =
      'This is a deliberately long comment intended to verify that the PDF builder line-wraps text rather than overflowing the page. '.repeat(8);
    expect(() => buildCustomerReportPdf(r)).not.toThrow();
  });

  it('produces a PDF that contains structural keywords', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5));
    const bytes = new Uint8Array(buffer);
    // Decode lossily — PDFs contain binary, but the trailer markers are ASCII.
    const text = new TextDecoder('latin1').decode(bytes);
    // Every PDF must end with %%EOF.
    expect(text).toMatch(/%%EOF\s*$/);
    // jsPDF outputs at least one /Pages object and a /Type /Catalog.
    expect(text).toContain('/Type');
  });
});
