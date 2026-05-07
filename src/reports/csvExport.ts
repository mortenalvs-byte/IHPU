// csvExport.ts — CSV writer for IHPU customer reports.
//
// The CSV is intentionally machine-readable: period decimal separator, no
// thousands separators, ISO-8601 timestamps, CRLF line endings. The metadata
// + summary header is followed by a blank line and a tabular section with
// the raw rows for the selected period.
//
// The pure functions (`buildReportCsv`, `buildSafeCsvFilename`) have no DOM
// dependencies and are exercised directly by Vitest. The DOM helper
// (`triggerCsvDownload`) is browser/Electron-renderer only.

import type { PressureRow } from '../domain/types';
import type { ReportModel } from './reportTypes';

const CRLF = '\r\n';

/**
 * Build the full CSV text for a report. Sections are separated by blank lines.
 *
 * @param report fully-built ReportModel
 * @param rows raw rows from the parser. The CSV emits the rows whose
 *   timestampMs falls inside the selected period (if any) — matching what
 *   the analysis layer used.
 */
export function buildReportCsv(report: ReportModel, rows: PressureRow[]): string {
  const lines: string[] = [];

  // ---- Metadata ----
  lines.push('# IHPU TrykkAnalyse — kunderapport (CSV)');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['Generert', report.generatedAtIso]));
  lines.push(row(['Kilde-fil', report.sourceFileName]));
  lines.push(row(['Kunde', report.metadata.customerName]));
  lines.push(row(['Prosjekt', report.metadata.projectNumber]));
  lines.push(row(['Lokasjon', report.metadata.location]));
  lines.push(row(['Test-dato', report.metadata.testDate]));
  lines.push(row(['IHPU serienummer', report.metadata.ihpuSerial]));
  lines.push(row(['ROV-system', report.metadata.rovSystem]));
  lines.push(row(['Operatør', report.metadata.operatorName]));
  lines.push(row(['Kommentar', report.metadata.comment]));
  lines.push('');

  // ---- Parser summary ----
  lines.push('# Parser-sammendrag');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['parsedRows', String(report.parser.parsedRows)]));
  lines.push(row(['warnings', String(report.parser.warnings)]));
  lines.push(row(['errors', String(report.parser.errors)]));
  lines.push(row(['firstTimestamp', report.parser.firstTimestamp ?? '']));
  lines.push(row(['lastTimestamp', report.parser.lastTimestamp ?? '']));
  lines.push(row(['durationMinutes', numberCell(report.parser.durationMinutes)]));
  lines.push('');

  // ---- Selected period ----
  lines.push('# Valgt periode');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['isFullRange', String(report.selectedPeriod.isFullRange)]));
  lines.push(row(['fromIso', report.selectedPeriod.fromIso ?? '']));
  lines.push(row(['toIso', report.selectedPeriod.toIso ?? '']));
  lines.push(row(['fromText', report.selectedPeriod.fromText]));
  lines.push(row(['toText', report.selectedPeriod.toText]));
  lines.push(row(['durationMinutes', numberCell(report.selectedPeriod.durationMinutes)]));
  lines.push('');

  // ---- Analysis ----
  lines.push('# Analyse');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['channel', report.analysis.channel]));
  lines.push(row(['startPressure_bar', numberCell(report.analysis.startPressure)]));
  lines.push(row(['endPressure_bar', numberCell(report.analysis.endPressure)]));
  lines.push(row(['dropBar', numberCell(report.analysis.dropBar)]));
  lines.push(row(['dropPctOfStart', numberCell(report.analysis.dropPctOfStart)]));
  lines.push(row(['dropPctOfTarget', numberCell(report.analysis.dropPctOfTarget)]));
  lines.push(row(['barPerMinute', numberCell(report.analysis.barPerMinute)]));
  lines.push(row(['barPerHour', numberCell(report.analysis.barPerHour)]));
  lines.push(row([
    'pressureIncreased',
    report.analysis.pressureIncreased === null ? '' : String(report.analysis.pressureIncreased)
  ]));
  lines.push('');

  // ---- Criteria ----
  lines.push('# Kriterier');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['maxDropPct', numberCell(report.criteria.maxDropPct)]));
  lines.push(row(['targetPressure_bar', numberCell(report.criteria.targetPressure)]));
  lines.push(row(['referencePressure_bar', numberCell(report.criteria.referencePressure)]));
  lines.push('');

  // ---- Hold result ----
  lines.push('# Holdperiode-resultat');
  lines.push(row(['Felt', 'Verdi']));
  lines.push(row(['status', report.hold.status]));
  lines.push(row(['usedDropPct', numberCell(report.hold.usedDropPct)]));
  lines.push(row(['allowedDropPct', numberCell(report.hold.allowedDropPct)]));
  lines.push(row(['marginPct', numberCell(report.hold.marginPct)]));
  lines.push(row(['warnings', String(report.hold.warnings.length)]));
  lines.push(row(['errors', String(report.hold.errors.length)]));
  for (const w of report.hold.warnings) lines.push(row(['warning', w]));
  for (const e of report.hold.errors) lines.push(row(['error', e]));
  lines.push('');

  // ---- Raw rows for selected period ----
  const rowsInRange = filterRowsToReportPeriod(rows, report);
  lines.push(`# Rader (${rowsInRange.length} av ${rows.length} parsede rader for valgt periode)`);
  lines.push(row(['index', 'sourceLine', 'localIso', 'tMinutes', 'p1', 'p2']));
  for (const r of rowsInRange) {
    lines.push(
      row([
        String(r.index),
        String(r.sourceLine),
        r.localIso,
        numberCell(r.tMinutes),
        numberCell(r.p1),
        numberCell(r.p2)
      ])
    );
  }

  return lines.join(CRLF) + CRLF;
}

/**
 * Compute a safe filename for a CSV/PDF artifact. Avoids characters that
 * Windows or Linux filesystems disallow, falls back to a timestamp-based
 * name when the report has no project metadata.
 */
export function buildSafeReportFilename(report: ReportModel, ext: 'csv' | 'pdf'): string {
  const project = sanitizeForFilename(report.metadata.projectNumber);
  const date = sanitizeForFilename(report.metadata.testDate || report.generatedAtIso.slice(0, 10));
  const status = report.hold.status;
  if (project && date) {
    return `IHPU_${project}_${date}_${status}.${ext}`;
  }
  // Fallback: deterministic-ish filename based on generation timestamp.
  const stamp = report.generatedAtIso
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '');
  return `IHPU_report_${stamp}.${ext}`;
}

/**
 * Browser/Electron-renderer-only helper. Triggers a CSV download via Blob +
 * anchor click. Throws if `document` is not available (e.g. when imported
 * from a Node-only context).
 */
export function triggerCsvDownload(csvText: string, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('triggerCsvDownload requires a DOM (browser or Electron renderer)');
  }
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  triggerBlobDownload(blob, filename);
}

// ---------- internal helpers ----------

function row(cells: string[]): string {
  return cells.map(escapeCsvCell).join(',');
}

function escapeCsvCell(value: string): string {
  if (value === '') return '';
  // Quote if value contains comma, quote, or newline.
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function numberCell(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  // Use sufficient precision to be machine-readable without rounding loss.
  return String(v);
}

function filterRowsToReportPeriod(rows: PressureRow[], report: ReportModel): PressureRow[] {
  if (report.selectedPeriod.isFullRange) return rows;
  const lo = report.selectedPeriod.fromIso ? Date.parse(report.selectedPeriod.fromIso + 'Z') : Number.NEGATIVE_INFINITY;
  const hi = report.selectedPeriod.toIso ? Date.parse(report.selectedPeriod.toIso + 'Z') : Number.POSITIVE_INFINITY;
  return rows.filter((r) => r.timestampMs >= lo && r.timestampMs <= hi);
}

function sanitizeForFilename(s: string): string {
  return s
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function triggerBlobDownload(blob: Blob, filename: string): void {
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
    // Defer revocation so the click handler has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
