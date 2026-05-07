// pdfReport.ts — jsPDF customer report.
//
// The pure builder (`buildCustomerReportPdf`) returns a Uint8Array that can
// be written to disk or wrapped in a Blob. It does not touch the DOM and is
// exercised directly by Vitest.
//
// Layout is deliberately simple: title, metadata block, selected period,
// criteria, analysis, prominent PASS/FAIL/UNKNOWN badge, hold-period detail,
// issues, and operator comment. Everything is text — no chart image, no
// embedded fonts, no external resources.

import { jsPDF } from 'jspdf';
import type { ReportModel } from './reportTypes';

// Visual constants — kept minimal so layout is predictable.
const PAGE_MARGIN = 18;            // mm
const HEADER_FONT_SIZE = 16;
const SECTION_FONT_SIZE = 11;
const BODY_FONT_SIZE = 10;
const BADGE_FONT_SIZE = 22;
const LINE_GAP = 5;                // mm
const SECTION_GAP = 4;             // mm

const COLOR_PASS: [number, number, number] = [42, 158, 96];
const COLOR_FAIL: [number, number, number] = [200, 60, 60];
const COLOR_UNKNOWN: [number, number, number] = [110, 110, 110];

/**
 * Build a customer report PDF. Returns the underlying ArrayBuffer so it can
 * be wrapped in a Blob for download from the renderer, or written to disk in
 * a Node-based test context. Use `new Uint8Array(buffer)` to inspect bytes.
 */
export function buildCustomerReportPdf(report: ReportModel): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;

  let y = PAGE_MARGIN;

  // ---- Title ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(HEADER_FONT_SIZE);
  doc.text('IHPU TrykkAnalyse — kunderapport', PAGE_MARGIN, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setTextColor(110);
  doc.text(`Generert: ${report.generatedAtIso}`, PAGE_MARGIN, y);
  y += 4;
  doc.text(`Kilde-fil: ${report.sourceFileName || '—'}`, PAGE_MARGIN, y);
  doc.setTextColor(0);
  y += SECTION_GAP * 2;

  // ---- Metadata ----
  y = renderSection(doc, y, 'Prosjekt', [
    ['Kunde', report.metadata.customerName || '—'],
    ['Prosjekt', report.metadata.projectNumber || '—'],
    ['Lokasjon', report.metadata.location || '—'],
    ['Test-dato', report.metadata.testDate || '—'],
    ['IHPU serienummer', report.metadata.ihpuSerial || '—'],
    ['ROV-system', report.metadata.rovSystem || '—'],
    ['Operatør', report.metadata.operatorName || '—']
  ]);

  // ---- Selected period ----
  const periodSummary = report.selectedPeriod.isFullRange
    ? 'Hele loggen'
    : `${report.selectedPeriod.fromIso ?? '—'} → ${report.selectedPeriod.toIso ?? '—'}`;
  y = renderSection(doc, y, 'Valgt periode', [
    ['Område', periodSummary],
    ['Varighet', fmtDuration(report.selectedPeriod.durationMinutes)],
    ['Kanal', report.analysis.channel.toUpperCase()]
  ]);

  // ---- Criteria ----
  y = renderSection(doc, y, 'Kriterier', [
    ['Maks tillatt drop', fmtPct(report.criteria.maxDropPct)],
    ['Måltrykk', fmtPressureOrDash(report.criteria.targetPressure)],
    ['Referansetrykk brukt', fmtPressureOrDash(report.criteria.referencePressure)]
  ]);

  // ---- PASS/FAIL/UNKNOWN badge ----
  y = renderResultBadge(doc, y, contentWidth, report.hold.status);

  // ---- Hold detail ----
  y = renderSection(doc, y, 'Holdperiode-detaljer', [
    ['Brukt drop %', fmtPct(report.hold.usedDropPct)],
    ['Tillatt drop %', fmtPct(report.hold.allowedDropPct)],
    ['Margin', fmtPct(report.hold.marginPct)]
  ]);

  // ---- Analysis ----
  y = renderSection(doc, y, 'Trykkfallanalyse', [
    ['Starttrykk', fmtPressureOrDash(report.analysis.startPressure)],
    ['Slutttrykk', fmtPressureOrDash(report.analysis.endPressure)],
    ['Trykkfall', fmtPressureOrDash(report.analysis.dropBar)],
    ['Drop % av start', fmtPct(report.analysis.dropPctOfStart)],
    ['Drop % av target', fmtPct(report.analysis.dropPctOfTarget)],
    ['Rate (bar/min)', fmtRate(report.analysis.barPerMinute, 'bar/min')],
    ['Rate (bar/hour)', fmtRate(report.analysis.barPerHour, 'bar/hour')],
    [
      'Trykket økte?',
      report.analysis.pressureIncreased === null
        ? '—'
        : report.analysis.pressureIncreased
          ? 'Ja'
          : 'Nei'
    ]
  ]);

  // ---- Parser summary ----
  y = renderSection(doc, y, 'Parser-sammendrag', [
    ['Parsede rader', String(report.parser.parsedRows)],
    ['Warnings', String(report.parser.warnings)],
    ['Errors', String(report.parser.errors)],
    ['Første tidspunkt', report.parser.firstTimestamp ?? '—'],
    ['Siste tidspunkt', report.parser.lastTimestamp ?? '—'],
    ['Logg-varighet', fmtDuration(report.parser.durationMinutes)]
  ]);

  // ---- Issues ----
  if (report.hold.warnings.length > 0 || report.hold.errors.length > 0) {
    y = ensureSpace(doc, y, pageHeight, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(SECTION_FONT_SIZE);
    doc.text('Meldinger', PAGE_MARGIN, y);
    y += LINE_GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    for (const e of report.hold.errors) {
      const lines = doc.splitTextToSize(`ERROR: ${e}`, contentWidth);
      for (const line of lines) {
        y = ensureSpace(doc, y, pageHeight, 6);
        doc.text(line, PAGE_MARGIN, y);
        y += 4.5;
      }
    }
    for (const w of report.hold.warnings) {
      const lines = doc.splitTextToSize(`WARNING: ${w}`, contentWidth);
      for (const line of lines) {
        y = ensureSpace(doc, y, pageHeight, 6);
        doc.text(line, PAGE_MARGIN, y);
        y += 4.5;
      }
    }
    y += SECTION_GAP;
  }

  // ---- Operator comment ----
  if (report.metadata.comment.trim().length > 0) {
    y = ensureSpace(doc, y, pageHeight, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(SECTION_FONT_SIZE);
    doc.text('Kommentar fra operatør', PAGE_MARGIN, y);
    y += LINE_GAP;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    const lines = doc.splitTextToSize(report.metadata.comment, contentWidth);
    for (const line of lines) {
      y = ensureSpace(doc, y, pageHeight, 6);
      doc.text(line, PAGE_MARGIN, y);
      y += 4.5;
    }
  }

  // ---- Footer ----
  doc.setFontSize(8);
  doc.setTextColor(140);
  const footer = `IHPU TrykkAnalyse · generert ${report.generatedAtIso}`;
  doc.text(footer, PAGE_MARGIN, pageHeight - 6);
  doc.setTextColor(0);

  return doc.output('arraybuffer') as ArrayBuffer;
}

/**
 * Browser/Electron-renderer-only helper. Triggers a PDF download via Blob.
 */
export function triggerPdfDownload(buffer: ArrayBuffer, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('triggerPdfDownload requires a DOM (browser or Electron renderer)');
  }
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ---------- internal helpers ----------

function renderSection(
  doc: jsPDF,
  y: number,
  title: string,
  rows: Array<[string, string]>
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const labelX = PAGE_MARGIN;
  const valueX = PAGE_MARGIN + 55;

  // Section header
  y = ensureSpace(doc, y, pageHeight, 8 + rows.length * 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_FONT_SIZE);
  doc.text(title, labelX, y);
  y += LINE_GAP;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);
  for (const [k, v] of rows) {
    y = ensureSpace(doc, y, pageHeight, 6);
    doc.setTextColor(110);
    doc.text(k, labelX, y);
    doc.setTextColor(0);
    doc.text(v, valueX, y);
    y += 4.5;
  }
  y += SECTION_GAP;
  return y;
}

function renderResultBadge(
  doc: jsPDF,
  y: number,
  contentWidth: number,
  status: 'PASS' | 'FAIL' | 'UNKNOWN'
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  y = ensureSpace(doc, y, pageHeight, 22);

  const color = status === 'PASS' ? COLOR_PASS : status === 'FAIL' ? COLOR_FAIL : COLOR_UNKNOWN;
  const badgeHeight = 14;

  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.6);
  doc.setFillColor(color[0], color[1], color[2]);
  // Filled rectangle behind text (full content width).
  doc.rect(PAGE_MARGIN, y, contentWidth, badgeHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(BADGE_FONT_SIZE);
  doc.setTextColor(255, 255, 255);
  const textWidth = doc.getTextWidth(status);
  const textX = PAGE_MARGIN + (contentWidth - textWidth) / 2;
  doc.text(status, textX, y + 10);

  // Reset state.
  doc.setTextColor(0);
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setFont('helvetica', 'normal');

  return y + badgeHeight + SECTION_GAP * 2;
}

function ensureSpace(doc: jsPDF, y: number, pageHeight: number, requiredMm: number): number {
  if (y + requiredMm > pageHeight - PAGE_MARGIN) {
    doc.addPage();
    return PAGE_MARGIN;
  }
  return y;
}

function fmtPressure(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(3) + ' bar';
}

function fmtPressureOrDash(v: number | null | undefined): string {
  return fmtPressure(v);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4) + ' %';
}

function fmtDuration(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(1) + ' min';
}

function fmtRate(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4) + ' ' + unit;
}
