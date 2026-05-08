import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import { calculatePressureDrop } from '../src/domain/pressureAnalysis';
import { buildCustomerReportPdf, type ChartImageInput } from '../src/reports/pdfReport';
import { buildReportModel } from '../src/reports/reportModel';
import {
  createDefaultMetadata,
  type ReportModel
} from '../src/reports/reportTypes';
import type { PressureRow } from '../src/domain/types';

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

// =====================================================================
// Chart-image inclusion (PR: report polish + chart image in PDF)
// =====================================================================

/**
 * Tiny 1×1 PNG embedded as base64 — exercises the PDF builder's chart-image
 * code path without pulling in canvas. Real chart captures use the same
 * `data:image/png;base64,...` shape, just much larger.
 */
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const TINY_CHART_IMAGE: ChartImageInput = {
  dataUrl: TINY_PNG_DATA_URL,
  widthPx: 800,
  heightPx: 400
};

describe('buildCustomerReportPdf: optional chart image', () => {
  it('renders a PDF without chart image (parity with pre-PR behaviour)', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5));
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).not.toContain('Trykkforløp');
  });

  it('renders a PDF with chart image and includes the Trykkforløp section', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      chartImage: TINY_CHART_IMAGE
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).toContain('Trykkforl');
  });

  it('PDF with chart image is materially larger than PDF without one', () => {
    const without = buildCustomerReportPdf(reportWithHold(5));
    const withChart = buildCustomerReportPdf(reportWithHold(5), {
      chartImage: TINY_CHART_IMAGE
    });
    // Even a 1x1 PNG adds embedded image bytes + xobject + section header.
    expect(withChart.byteLength).toBeGreaterThan(without.byteLength);
  });

  it('handles a tall chart aspect ratio (caps at 90mm visual height)', () => {
    expect(() =>
      buildCustomerReportPdf(reportWithHold(5), {
        chartImage: { dataUrl: TINY_PNG_DATA_URL, widthPx: 100, heightPx: 600 }
      })
    ).not.toThrow();
  });

  it('does not throw on a chart image with non-positive dimensions (zero-aspect fallback)', () => {
    expect(() =>
      buildCustomerReportPdf(reportWithHold(5), {
        chartImage: { dataUrl: TINY_PNG_DATA_URL, widthPx: 0, heightPx: 0 }
      })
    ).not.toThrow();
  });
});

// =====================================================================
// Raw-data table (Rådata)
// =====================================================================

describe('buildCustomerReportPdf: optional raw-data table', () => {
  it('renders a PDF without rows (no Rådata section)', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5));
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).not.toContain('R\xe5data'); // latin1 'Rådata' — å is 0xE5
  });

  it('full fixture (461 rows) is included verbatim, no truncation marker', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: parsed.rows
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).toContain('461 rader');
    // No truncation marker because 461 <= 1000.
    expect(text).not.toContain('rader utelatt');
    expect(text).not.toContain('utelatt');
  });

  it('PDF size grows materially when the raw-data table is included', () => {
    const without = buildCustomerReportPdf(reportWithHold(5));
    const withRows = buildCustomerReportPdf(reportWithHold(5), {
      rows: parsed.rows
    });
    expect(withRows.byteLength).toBeGreaterThan(without.byteLength + 5_000);
  });

  it('chart image + raw-data together produce the largest PDF', () => {
    const both = buildCustomerReportPdf(reportWithHold(5), {
      chartImage: TINY_CHART_IMAGE,
      rows: parsed.rows
    });
    const onlyRows = buildCustomerReportPdf(reportWithHold(5), {
      rows: parsed.rows
    });
    expect(both.byteLength).toBeGreaterThan(onlyRows.byteLength);
  });

  it('truncates a synthetic 1500-row payload to first 500 + marker + last 500', () => {
    const synthetic = synthesizeRows(1500);
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: synthetic
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    // Expect the marker count to equal omittedCount (1500 - 1000 = 500).
    expect(text).toContain('500 rader utelatt');
  });

  it('exactly 1000 rows is NOT truncated (boundary)', () => {
    const synthetic = synthesizeRows(1000);
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: synthetic
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).not.toContain('rader utelatt');
  });

  it('1001 rows IS truncated (just-over boundary)', () => {
    const synthetic = synthesizeRows(1001);
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: synthetic
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).toContain('1 rader utelatt');
  });

  it('handles an empty rows array gracefully ("Ingen rader i valgt periode")', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5), { rows: [] });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    expect(text).toContain('Ingen rader');
  });

  it('formats tMinutes with 3 decimal places to prevent column overflow', () => {
    // Regression: irrational tMinutes (e.g. 7-second intervals → 0.11666...)
    // used to be emitted via String(v) which wrote up to 17 digits and
    // visually collided with the next column. The fix clamps to .toFixed(3).
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: parsed.rows
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    // Row 1 of the canonical fixture: 7 s after row 0 → tMinutes ≈ 0.1167.
    // Expect the rounded form to be present, NOT the long-decimal form.
    expect(text).toContain('0.117');
    expect(text).not.toContain('0.11666666666');
    expect(text).not.toContain('0.23333333333');
  });

  it('handles tMinutes of 0 cleanly (first row)', () => {
    const buffer = buildCustomerReportPdf(reportWithHold(5), {
      rows: parsed.rows
    });
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    // First row's tMinutes is 0 → should render as "0.000".
    expect(text).toContain('0.000');
  });
});

function synthesizeRows(count: number): PressureRow[] {
  // Build minimal, well-typed rows so we don't depend on the parser. The
  // PDF builder reads only index, sourceLine, localIso, tMinutes, p1, p2.
  const rows: PressureRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      index: i,
      sourceLine: i + 1,
      raw: '',
      dateText: '21.02.2026',
      timeText: '13:00:00',
      localIso: '2026-02-21T13:00:00',
      // Use a stable but unique timestamp so range filtering picks them all up.
      timestampMs: Date.UTC(2026, 1, 21, 13, 0, 0) + i * 1000,
      tMinutes: i / 60,
      p1: -2.5 + i * 0.0001,
      p2: 320 - i * 0.01
    });
  }
  return rows;
}
