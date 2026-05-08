// pdfReport.ts — jsPDF customer report.
//
// The pure builder (`buildCustomerReportPdf`) returns an ArrayBuffer that can
// be written to disk or wrapped in a Blob. It does not touch the DOM, never
// imports Chart.js, and is exercised directly by Vitest.
//
// Layout: title, metadata, selected period, criteria, PASS/FAIL/UNKNOWN
// badge, optional chart image (Trykkforløp), hold-period detail, analysis,
// optional raw-data table (Rådata) for the selected period, parser summary,
// issues, comment, footer. The chart image and raw-data rows are passed in
// by the caller via the options object — the builder itself never captures
// canvases or filters rows. See report-polish-chart-image-and-raw-data.md.

import { jsPDF } from 'jspdf';
import type { PressureRow } from '../domain/types';
import {
  applyRawDataTruncation,
  filterRowsToReportPeriod,
  RAW_DATA_TRUNCATION_HALF
} from './reportRows';
import type { ReportModel } from './reportTypes';

// Visual constants — kept minimal so layout is predictable.
const PAGE_MARGIN = 18;            // mm
const HEADER_FONT_SIZE = 16;
const SECTION_FONT_SIZE = 11;
const BODY_FONT_SIZE = 10;
const BADGE_FONT_SIZE = 22;
const LINE_GAP = 5;                // mm
const SECTION_GAP = 4;             // mm

// Raw-data table layout (mm). Column widths sum to ~contentWidth for A4.
const TABLE_FONT_SIZE = 8;
const TABLE_HEADER_HEIGHT = 5;
const TABLE_ROW_HEIGHT = 4;
const TABLE_COL_WIDTHS = [12, 60, 22, 30, 30]; // # / localIso / tMinutes / p1 / p2
const TABLE_HEADER_FILL: [number, number, number] = [232, 232, 232];

// Chart image layout
const CHART_MAX_HEIGHT_MM = 90;

const COLOR_PASS: [number, number, number] = [42, 158, 96];
const COLOR_FAIL: [number, number, number] = [200, 60, 60];
const COLOR_UNKNOWN: [number, number, number] = [110, 110, 110];

export interface ChartImageInput {
  /** Base64-encoded PNG data URL — `data:image/png;base64,...` */
  dataUrl: string;
  /** Source canvas pixel width. Used only to compute aspect ratio in the PDF. */
  widthPx: number;
  /** Source canvas pixel height. Used only to compute aspect ratio in the PDF. */
  heightPx: number;
}

export interface BuildPdfOptions {
  /**
   * Optional chart image. When supplied, a "Trykkforløp" section is rendered
   * after the PASS/FAIL/UNKNOWN badge with the image scaled to full content
   * width and a maximum visual height of 90 mm (aspect ratio preserved).
   * The chart image carries the operator's selected-period highlight as
   * drawn in the live UI — no extra DOM work happens here.
   */
  chartImage?: ChartImageInput;
  /**
   * Optional raw rows. When supplied, a "Rådata" section is rendered after
   * the analysis summary, filtered to the selected period via the same rule
   * as the CSV export. Rows are emitted under the truncation rule:
   *   - <= 1000 rows  → all rows verbatim
   *   - >  1000 rows  → first 500 + omission marker + last 500
   * Pass the raw `state.parseResult.rows` here; do NOT pre-filter or
   * pre-truncate. The function does both internally.
   */
  rows?: PressureRow[];
}

/**
 * Build a customer report PDF. Returns the underlying ArrayBuffer so it can
 * be wrapped in a Blob for download from the renderer, or written to disk in
 * a Node-based test context. Use `new Uint8Array(buffer)` to inspect bytes.
 *
 * Both `options.chartImage` and `options.rows` are optional; when omitted,
 * the corresponding section is simply skipped. This means callers (like
 * the smoke test or PDF unit tests) can build a PDF without a chart or
 * without raw data, and operators get a chartless PDF gracefully if the
 * canvas is not yet ready at export time.
 */
export function buildCustomerReportPdf(
  report: ReportModel,
  options: BuildPdfOptions = {}
): ArrayBuffer {
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

  // ---- Chart image (Trykkforløp) — optional ----
  if (options.chartImage) {
    y = renderChartImage(doc, y, pageHeight, contentWidth, options.chartImage);
  }

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

  // ---- Raw data table (Rådata) — optional ----
  if (options.rows) {
    y = renderRawDataTable(doc, y, pageHeight, contentWidth, report, options.rows);
  }

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

function renderChartImage(
  doc: jsPDF,
  y: number,
  pageHeight: number,
  contentWidth: number,
  image: ChartImageInput
): number {
  // Compute proportional render height from canvas pixel ratio. Cap at
  // CHART_MAX_HEIGHT_MM so a tall canvas doesn't push everything else off
  // the page. Width is always full content-width.
  const aspect = image.heightPx > 0 ? image.heightPx / image.widthPx : 0.5;
  const renderWidth = contentWidth;
  const naturalHeight = renderWidth * aspect;
  const renderHeight = Math.min(naturalHeight, CHART_MAX_HEIGHT_MM);

  // Need room for section header (~7mm) + image + section gap.
  y = ensureSpace(doc, y, pageHeight, renderHeight + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_FONT_SIZE);
  doc.text('Trykkforløp', PAGE_MARGIN, y);
  y += LINE_GAP;

  // jsPDF accepts a base64 data URL directly for PNG. The width/height args
  // are in mm; aspect ratio is preserved by jsPDF when both are supplied.
  doc.addImage(image.dataUrl, 'PNG', PAGE_MARGIN, y, renderWidth, renderHeight);
  y += renderHeight;

  // Caption hint so the customer knows what the highlight (if any) means.
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(BODY_FONT_SIZE - 1);
  doc.setTextColor(110);
  doc.text(
    'Markert område viser valgt analyse-periode (når satt).',
    PAGE_MARGIN,
    y + 3.5
  );
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(BODY_FONT_SIZE);

  return y + 3.5 + SECTION_GAP * 2;
}

function renderRawDataTable(
  doc: jsPDF,
  y: number,
  pageHeight: number,
  contentWidth: number,
  report: ReportModel,
  rows: PressureRow[]
): number {
  const filtered = filterRowsToReportPeriod(rows, report);
  const truncation = applyRawDataTruncation(filtered);
  const totalForReport = filtered.length;

  // Section header.
  y = ensureSpace(doc, y, pageHeight, 16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(SECTION_FONT_SIZE);
  const headerText =
    truncation.omittedCount > 0
      ? `Rådata (${totalForReport} rader for valgt periode — viser første ${RAW_DATA_TRUNCATION_HALF} + siste ${RAW_DATA_TRUNCATION_HALF}, ${truncation.omittedCount} utelatt)`
      : `Rådata (${totalForReport} rader for valgt periode)`;
  doc.text(headerText, PAGE_MARGIN, y);
  y += LINE_GAP;

  if (filtered.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(110);
    doc.text('Ingen rader i valgt periode.', PAGE_MARGIN, y);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    return y + LINE_GAP;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TABLE_FONT_SIZE);

  // The header is rendered at the top of the section AND repeated on every
  // page break that occurs while emitting body rows. Keeps the table
  // self-describing on every printed page.
  y = renderTableHeader(doc, y, contentWidth);

  for (const row of truncation.firstHalf) {
    if (y + TABLE_ROW_HEIGHT > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = renderTableHeader(doc, y, contentWidth);
    }
    renderTableRow(doc, y, row);
    y += TABLE_ROW_HEIGHT;
  }

  if (truncation.secondHalf !== null) {
    if (y + TABLE_ROW_HEIGHT > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = renderTableHeader(doc, y, contentWidth);
    }
    renderOmissionMarker(doc, y, contentWidth, truncation.omittedCount);
    y += TABLE_ROW_HEIGHT;

    for (const row of truncation.secondHalf) {
      if (y + TABLE_ROW_HEIGHT > pageHeight - PAGE_MARGIN) {
        doc.addPage();
        y = PAGE_MARGIN;
        y = renderTableHeader(doc, y, contentWidth);
      }
      renderTableRow(doc, y, row);
      y += TABLE_ROW_HEIGHT;
    }
  }

  // Reset font state for following sections.
  doc.setFontSize(BODY_FONT_SIZE);
  doc.setFont('helvetica', 'normal');

  return y + SECTION_GAP;
}

function renderTableHeader(doc: jsPDF, y: number, contentWidth: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TABLE_FONT_SIZE);
  doc.setFillColor(TABLE_HEADER_FILL[0], TABLE_HEADER_FILL[1], TABLE_HEADER_FILL[2]);
  doc.rect(PAGE_MARGIN, y - 3.5, contentWidth, TABLE_HEADER_HEIGHT, 'F');
  const labels = ['#', 'localIso', 'tMinutes', 'p1', 'p2'];
  let x = PAGE_MARGIN + 1.5;
  for (let i = 0; i < labels.length; i++) {
    doc.text(labels[i]!, x, y);
    x += TABLE_COL_WIDTHS[i]!;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TABLE_FONT_SIZE);
  return y + TABLE_HEADER_HEIGHT;
}

function renderTableRow(doc: jsPDF, y: number, row: PressureRow): void {
  const cells = [
    String(row.index),
    row.localIso,
    fmtNumber(row.tMinutes),
    fmtNumber(row.p1),
    fmtNumber(row.p2)
  ];
  let x = PAGE_MARGIN + 1.5;
  for (let i = 0; i < cells.length; i++) {
    doc.text(cells[i]!, x, y);
    x += TABLE_COL_WIDTHS[i]!;
  }
}

function renderOmissionMarker(
  doc: jsPDF,
  y: number,
  contentWidth: number,
  omittedCount: number
): void {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(TABLE_FONT_SIZE);
  doc.setTextColor(110);
  doc.text(
    `… ${omittedCount} rader utelatt …`,
    PAGE_MARGIN + contentWidth / 2,
    y,
    { align: 'center' }
  );
  doc.setTextColor(0);
  doc.setFont('helvetica', 'normal');
}

function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return String(v);
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
