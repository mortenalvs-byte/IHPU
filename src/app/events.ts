// events.ts — wires DOM inputs to AppState mutations and re-renders.
//
// File reading uses File.text() (browser/Electron renderer API). The parser
// and analysis modules are pure domain functions — they receive the text and
// return structured ParseResult / PressureDropResult / HoldPeriodResult.

import type { PressureChart, SelectedRange } from '../charts/pressureChart';
import { evaluateHoldPeriod } from '../domain/holdPeriod';
import { parseIhpuPressureLog } from '../domain/ihpuParser';
import { calculatePressureDrop, selectRowsInTimeRange } from '../domain/pressureAnalysis';
import type { PressureChannel, PressureRow } from '../domain/types';
import { buildManualParseResult } from '../manual/manualRows';
import {
  newManualRow,
  type DataSourceMode,
  type ManualRow
} from '../manual/manualTypes';
import { parseManualPaste, validateManualRows } from '../manual/manualValidation';
import {
  buildReportCsv,
  buildSafeReportFilename,
  triggerCsvDownload
} from '../reports/csvExport';
import { buildCustomerReportPdf, triggerPdfDownload } from '../reports/pdfReport';
import { buildReportModel } from '../reports/reportModel';
import type { ReportMetadata } from '../reports/reportTypes';
import { parseTimeParts, toDeterministicTimestampMs } from '../utils/dateTime';
import { msToTimeText, render } from './render';
import type { AppState } from './state';

interface AppContext {
  root: HTMLElement;
  state: AppState;
  chart: PressureChart;
}

export function wireEvents(ctx: AppContext): void {
  const fileInput = qs<HTMLInputElement>(ctx.root, 'file-input');
  const channelSelect = qs<HTMLSelectElement>(ctx.root, 'channel-select');
  const maxDropInput = qs<HTMLInputElement>(ctx.root, 'max-drop-input');
  const targetInput = qs<HTMLInputElement>(ctx.root, 'target-pressure-input');
  const fromInput = qs<HTMLInputElement>(ctx.root, 'period-from-input');
  const toInput = qs<HTMLInputElement>(ctx.root, 'period-to-input');
  const resetPeriodBtn = qs<HTMLButtonElement>(ctx.root, 'reset-period-selection');
  const resetZoomBtn = qs<HTMLButtonElement>(ctx.root, 'reset-chart-zoom');

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      void handleFileSelected(ctx, fileInput);
    });
  }

  if (channelSelect) {
    channelSelect.value = ctx.state.selectedChannel;
    channelSelect.addEventListener('change', () => {
      const v = channelSelect.value;
      if (v === 'p1' || v === 'p2') {
        ctx.state.selectedChannel = v as PressureChannel;
        recomputeAnalysis(ctx);
        render(ctx.root, ctx.state);
      }
    });
  }

  if (maxDropInput) {
    maxDropInput.value = String(ctx.state.maxDropPct);
    maxDropInput.addEventListener('input', () => {
      const n = Number(maxDropInput.value);
      if (Number.isFinite(n) && n >= 0) {
        ctx.state.maxDropPct = n;
        recomputeAnalysis(ctx);
        render(ctx.root, ctx.state);
      }
    });
  }

  if (targetInput) {
    targetInput.addEventListener('input', () => {
      const raw = targetInput.value.trim();
      if (raw === '') {
        ctx.state.targetPressure = null;
      } else {
        const n = Number(raw);
        ctx.state.targetPressure = Number.isFinite(n) ? n : null;
      }
      recomputeAnalysis(ctx);
      render(ctx.root, ctx.state);
    });
  }

  if (fromInput) {
    fromInput.addEventListener('input', () => {
      ctx.state.selectedFromTimeText = fromInput.value;
      applyPeriodInputs(ctx);
    });
  }

  if (toInput) {
    toInput.addEventListener('input', () => {
      ctx.state.selectedToTimeText = toInput.value;
      applyPeriodInputs(ctx);
    });
  }

  if (resetPeriodBtn) {
    resetPeriodBtn.addEventListener('click', () => {
      ctx.state.selectedFromTimestampMs = null;
      ctx.state.selectedToTimestampMs = null;
      ctx.state.selectedFromTimeText = '';
      ctx.state.selectedToTimeText = '';
      ctx.state.chartError = null;
      ctx.chart.setSelectedRange(null);
      recomputeAnalysis(ctx);
      render(ctx.root, ctx.state);
    });
  }

  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', () => {
      ctx.chart.resetZoom();
    });
  }

  // Report metadata inputs
  const metadataMap: Array<[string, keyof ReportMetadata]> = [
    ['report-customer-input', 'customerName'],
    ['report-project-input', 'projectNumber'],
    ['report-location-input', 'location'],
    ['report-test-date-input', 'testDate'],
    ['report-ihpu-serial-input', 'ihpuSerial'],
    ['report-rov-system-input', 'rovSystem'],
    ['report-operator-input', 'operatorName'],
    ['report-comment-input', 'comment']
  ];
  for (const [testId, key] of metadataMap) {
    const input = qs<HTMLInputElement | HTMLTextAreaElement>(ctx.root, testId);
    if (!input) continue;
    input.addEventListener('input', () => {
      ctx.state.reportMetadata = {
        ...ctx.state.reportMetadata,
        [key]: input.value
      };
      render(ctx.root, ctx.state);
    });
  }

  // Export buttons
  const exportCsvBtn = qs<HTMLButtonElement>(ctx.root, 'export-csv-button');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      handleExportCsv(ctx);
    });
  }

  const exportPdfBtn = qs<HTMLButtonElement>(ctx.root, 'export-pdf-button');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      handleExportPdf(ctx);
    });
  }

  // Manual entry: source-mode radios
  const sourceModeRoot = qs<HTMLElement>(ctx.root, 'data-source-mode');
  if (sourceModeRoot) {
    sourceModeRoot.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | null;
      if (!target || target.name !== 'data-source-mode') return;
      const v = target.value;
      if (v === 'file' || v === 'manual') {
        handleSourceModeChange(ctx, v);
      }
    });
  }

  const manualAddBtn = qs<HTMLButtonElement>(ctx.root, 'manual-add-row-button');
  if (manualAddBtn) {
    manualAddBtn.addEventListener('click', () => handleManualRowAdd(ctx));
  }

  const manualPasteBtn = qs<HTMLButtonElement>(ctx.root, 'manual-paste-button');
  if (manualPasteBtn) {
    manualPasteBtn.addEventListener('click', () => handleManualPaste(ctx));
  }

  const manualClearBtn = qs<HTMLButtonElement>(ctx.root, 'manual-clear-rows');
  if (manualClearBtn) {
    manualClearBtn.addEventListener('click', () => handleManualClear(ctx));
  }

  const manualUseBtn = qs<HTMLButtonElement>(ctx.root, 'manual-use-rows-button');
  if (manualUseBtn) {
    manualUseBtn.addEventListener('click', () => handleUseManualRows(ctx));
  }

  // Event delegation for per-row delete buttons in the manual table.
  const manualTable = qs<HTMLElement>(ctx.root, 'manual-table');
  if (manualTable) {
    manualTable.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest<HTMLButtonElement>('[data-testid="manual-delete-row"]');
      if (!btn) return;
      const rowId = btn.dataset.rowId;
      if (!rowId) return;
      handleManualDelete(ctx, rowId);
    });
  }
}

function handleExportCsv(ctx: AppContext): void {
  const result = buildReportModel({
    parseResult: ctx.state.parseResult,
    baselineDrop: ctx.state.baselineDrop,
    targetDrop: ctx.state.targetDrop,
    holdResult: ctx.state.holdResult,
    selectedChannel: ctx.state.selectedChannel,
    maxDropPct: ctx.state.maxDropPct,
    targetPressure: ctx.state.targetPressure,
    selectedFromTimestampMs: ctx.state.selectedFromTimestampMs,
    selectedToTimestampMs: ctx.state.selectedToTimestampMs,
    selectedFromTimeText: ctx.state.selectedFromTimeText,
    selectedToTimeText: ctx.state.selectedToTimeText,
    selectedFileName: ctx.state.selectedFileName,
    reportMetadata: ctx.state.reportMetadata
  });
  if (!result.ok) {
    ctx.state.exportStatus = { kind: 'error', message: `CSV-eksport feilet: ${result.error.message}` };
    render(ctx.root, ctx.state);
    return;
  }
  try {
    const rows = ctx.state.parseResult?.rows ?? [];
    const csvText = buildReportCsv(result.report, rows);
    const filename = buildSafeReportFilename(result.report, 'csv');
    const sizeBytes = new TextEncoder().encode(csvText).length;
    triggerCsvDownload(csvText, filename);
    ctx.state.exportStatus = {
      kind: 'success',
      message: `CSV exported: ${filename} (${sizeBytes} bytes)`
    };
  } catch (err) {
    ctx.state.exportStatus = {
      kind: 'error',
      message: `CSV-eksport feilet: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  render(ctx.root, ctx.state);
}

function handleExportPdf(ctx: AppContext): void {
  const result = buildReportModel({
    parseResult: ctx.state.parseResult,
    baselineDrop: ctx.state.baselineDrop,
    targetDrop: ctx.state.targetDrop,
    holdResult: ctx.state.holdResult,
    selectedChannel: ctx.state.selectedChannel,
    maxDropPct: ctx.state.maxDropPct,
    targetPressure: ctx.state.targetPressure,
    selectedFromTimestampMs: ctx.state.selectedFromTimestampMs,
    selectedToTimestampMs: ctx.state.selectedToTimestampMs,
    selectedFromTimeText: ctx.state.selectedFromTimeText,
    selectedToTimeText: ctx.state.selectedToTimeText,
    selectedFileName: ctx.state.selectedFileName,
    reportMetadata: ctx.state.reportMetadata
  });
  if (!result.ok) {
    ctx.state.exportStatus = { kind: 'error', message: `PDF-eksport feilet: ${result.error.message}` };
    render(ctx.root, ctx.state);
    return;
  }
  try {
    const buffer = buildCustomerReportPdf(result.report);
    const filename = buildSafeReportFilename(result.report, 'pdf');
    triggerPdfDownload(buffer, filename);
    ctx.state.exportStatus = {
      kind: 'success',
      message: `PDF exported: ${filename} (${buffer.byteLength} bytes)`
    };
  } catch (err) {
    ctx.state.exportStatus = {
      kind: 'error',
      message: `PDF-eksport feilet: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  render(ctx.root, ctx.state);
}

async function handleFileSelected(ctx: AppContext, input: HTMLInputElement): Promise<void> {
  const file = input.files && input.files[0];
  if (!file) return;

  ctx.state.userMessage = null;
  ctx.state.chartError = null;
  ctx.state.selectedFileName = file.name;
  ctx.state.sourceMode = 'file';

  // Reset any prior period selection — a new file means a new range.
  ctx.state.selectedFromTimestampMs = null;
  ctx.state.selectedToTimestampMs = null;
  ctx.state.selectedFromTimeText = '';
  ctx.state.selectedToTimeText = '';
  ctx.chart.setSelectedRange(null);

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    ctx.state.fileParseResult = null;
    ctx.state.parseResult = null;
    ctx.state.baselineDrop = null;
    ctx.state.targetDrop = null;
    ctx.state.holdResult = null;
    ctx.state.chartReady = false;
    ctx.chart.destroy();
    ctx.state.userMessage = {
      severity: 'error',
      text: `Kunne ikke lese filen: ${err instanceof Error ? err.message : String(err)}`
    };
    render(ctx.root, ctx.state);
    return;
  }

  try {
    const fileResult = parseIhpuPressureLog(text, { sourceName: file.name });
    ctx.state.fileParseResult = fileResult;
    ctx.state.parseResult = fileResult;
  } catch (err) {
    ctx.state.fileParseResult = null;
    ctx.state.parseResult = null;
    ctx.state.userMessage = {
      severity: 'error',
      text: `Uventet parser-feil: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  applyActiveSource(ctx);
  render(ctx.root, ctx.state);
}

/**
 * Recompute everything that depends on the active data source: rebuild the
 * `parseResult` pointer (file vs manual), re-run analysis, refresh the chart.
 *
 * Called whenever a source becomes active or its underlying data changes
 * (file uploaded, manual rows committed via "Bruk manuelle rader", source
 * mode toggled by the radio).
 */
function applyActiveSource(ctx: AppContext): void {
  if (ctx.state.sourceMode === 'manual') {
    if (ctx.state.manualRows.length > 0) {
      const sourceName =
        ctx.state.selectedFileName && ctx.state.selectedFileName.startsWith('Manual entry')
          ? ctx.state.selectedFileName
          : 'Manual entry';
      ctx.state.parseResult = buildManualParseResult(ctx.state.manualRows, sourceName);
      ctx.state.selectedFileName = sourceName;
    } else {
      ctx.state.parseResult = null;
    }
  } else {
    ctx.state.parseResult = ctx.state.fileParseResult;
  }

  // Reset period selection when the source changes — old timestamps may not
  // exist in the new dataset.
  if (ctx.state.parseResult === null) {
    ctx.state.selectedFromTimestampMs = null;
    ctx.state.selectedToTimestampMs = null;
    ctx.state.selectedFromTimeText = '';
    ctx.state.selectedToTimeText = '';
  }

  recomputeAnalysis(ctx);

  // Re-mount the chart with the new dataset (or destroy if empty).
  if (ctx.state.parseResult && ctx.state.parseResult.rows.length > 0) {
    try {
      ctx.chart.setData(ctx.state.parseResult.rows);
      ctx.chart.setSelectedRange(null);
      ctx.state.chartReady = true;
      ctx.state.chartError = null;
    } catch (err) {
      ctx.state.chartReady = false;
      ctx.state.chartError = err instanceof Error ? err.message : String(err);
    }
  } else {
    ctx.chart.destroy();
    ctx.state.chartReady = false;
  }
}

// ---------- manual entry handlers ----------

function recomputeManualValidation(ctx: AppContext): void {
  ctx.state.manualValidation = validateManualRows(ctx.state.manualRows);
}

function handleSourceModeChange(ctx: AppContext, mode: DataSourceMode): void {
  if (ctx.state.sourceMode === mode) return;
  ctx.state.sourceMode = mode;
  applyActiveSource(ctx);
  render(ctx.root, ctx.state);
}

function handleManualRowAdd(ctx: AppContext): void {
  const dateInput = qs<HTMLInputElement>(ctx.root, 'manual-date-input');
  const timeInput = qs<HTMLInputElement>(ctx.root, 'manual-time-input');
  const p1Input = qs<HTMLInputElement>(ctx.root, 'manual-p1-input');
  const p2Input = qs<HTMLInputElement>(ctx.root, 'manual-p2-input');
  if (!dateInput || !timeInput || !p1Input || !p2Input) return;

  const row: ManualRow = newManualRow({
    dateText: dateInput.value,
    timeText: timeInput.value,
    p1Text: p1Input.value,
    p2Text: p2Input.value
  });
  ctx.state.manualRows = [...ctx.state.manualRows, row];

  // Clear inputs so the operator can type the next row immediately.
  dateInput.value = '';
  timeInput.value = '';
  p1Input.value = '';
  p2Input.value = '';

  recomputeManualValidation(ctx);
  render(ctx.root, ctx.state);
}

function handleManualPaste(ctx: AppContext): void {
  const pasteInput = qs<HTMLTextAreaElement>(ctx.root, 'manual-paste-input');
  if (!pasteInput) return;
  const text = pasteInput.value;
  if (text.trim() === '') return;

  const outcome = parseManualPaste(text);
  if (outcome.rows.length > 0) {
    ctx.state.manualRows = [...ctx.state.manualRows, ...outcome.rows];
  }
  // Clear the textarea after paste so subsequent pastes are clean.
  pasteInput.value = '';

  recomputeManualValidation(ctx);

  ctx.state.userMessage = {
    severity: outcome.rejected > 0 ? 'warning' : 'info',
    text: `Lim inn fullført: ${outcome.imported} importert, ${outcome.rejected} avvist.`
  };

  render(ctx.root, ctx.state);
}

function handleManualDelete(ctx: AppContext, rowId: string): void {
  ctx.state.manualRows = ctx.state.manualRows.filter((r) => r.id !== rowId);
  recomputeManualValidation(ctx);

  // If we're using manual rows as the active source, refresh the pipeline.
  if (ctx.state.sourceMode === 'manual') {
    applyActiveSource(ctx);
  }

  render(ctx.root, ctx.state);
}

function handleManualClear(ctx: AppContext): void {
  ctx.state.manualRows = [];
  recomputeManualValidation(ctx);
  if (ctx.state.sourceMode === 'manual') {
    applyActiveSource(ctx);
  }
  render(ctx.root, ctx.state);
}

function handleUseManualRows(ctx: AppContext): void {
  recomputeManualValidation(ctx);
  ctx.state.sourceMode = 'manual';
  applyActiveSource(ctx);
  render(ctx.root, ctx.state);
}

function applyPeriodInputs(ctx: AppContext): void {
  const pr = ctx.state.parseResult;
  if (!pr || pr.rows.length === 0) {
    return;
  }

  const fromText = ctx.state.selectedFromTimeText.trim();
  const toText = ctx.state.selectedToTimeText.trim();

  const fromMs = fromText === '' ? null : timeTextToMsOnLogDate(fromText, pr.rows);
  const toMs = toText === '' ? null : timeTextToMsOnLogDate(toText, pr.rows);

  if (fromText !== '' && fromMs === null) {
    ctx.state.chartError = `Ugyldig fra-tid: "${fromText}". Bruk HH:MM eller HH:MM:SS.`;
    render(ctx.root, ctx.state);
    return;
  }
  if (toText !== '' && toMs === null) {
    ctx.state.chartError = `Ugyldig til-tid: "${toText}". Bruk HH:MM eller HH:MM:SS.`;
    render(ctx.root, ctx.state);
    return;
  }

  ctx.state.chartError = null;

  // Normalise: if both are present and from > to, swap them.
  let normFrom = fromMs;
  let normTo = toMs;
  if (normFrom !== null && normTo !== null && normFrom > normTo) {
    [normFrom, normTo] = [normTo, normFrom];
  }

  ctx.state.selectedFromTimestampMs = normFrom;
  ctx.state.selectedToTimestampMs = normTo;
  updateChartHighlight(ctx);
  recomputeAnalysis(ctx);
  render(ctx.root, ctx.state);
}

/**
 * Drag-select callback from the chart. Updates state and re-runs analysis.
 */
export function handleChartPeriodSelected(ctx: AppContext, range: SelectedRange): void {
  ctx.state.selectedFromTimestampMs = range.fromMs;
  ctx.state.selectedToTimestampMs = range.toMs;
  ctx.state.selectedFromTimeText = msToTimeText(range.fromMs);
  ctx.state.selectedToTimeText = msToTimeText(range.toMs);
  ctx.state.chartError = null;
  ctx.chart.setSelectedRange({ fromMs: range.fromMs, toMs: range.toMs });
  recomputeAnalysis(ctx);
  render(ctx.root, ctx.state);
}

function updateChartHighlight(ctx: AppContext): void {
  const fromMs = ctx.state.selectedFromTimestampMs;
  const toMs = ctx.state.selectedToTimestampMs;
  if (fromMs === null && toMs === null) {
    ctx.chart.setSelectedRange(null);
    return;
  }
  const pr = ctx.state.parseResult;
  if (!pr || pr.rows.length === 0) return;
  const effectiveFrom = fromMs ?? pr.rows[0].timestampMs;
  const effectiveTo = toMs ?? pr.rows[pr.rows.length - 1].timestampMs;
  ctx.chart.setSelectedRange({ fromMs: effectiveFrom, toMs: effectiveTo });
}

function recomputeAnalysis(ctx: AppContext): void {
  const pr = ctx.state.parseResult;
  if (!pr || pr.rows.length === 0) {
    ctx.state.baselineDrop = null;
    ctx.state.targetDrop = null;
    ctx.state.holdResult = null;
    return;
  }

  const channel = ctx.state.selectedChannel;
  const fromMs = ctx.state.selectedFromTimestampMs ?? undefined;
  const toMs = ctx.state.selectedToTimestampMs ?? undefined;

  // Range-filtering model: the UI pre-filters rows ONCE via the domain helper
  // selectRowsInTimeRange. The downstream domain functions (calculatePressureDrop,
  // evaluateHoldPeriod) then receive already-narrowed rows and we deliberately
  // do NOT also pass fromTimestampMs/toTimestampMs to evaluateHoldPeriod —
  // that would refilter an already-filtered list and silently work today
  // because the result is identical, but it is confusing and brittle.
  // Single source of filtering = single source of truth for the analyzed range.
  const rows = selectRowsInTimeRange(pr.rows, fromMs, toMs);

  ctx.state.baselineDrop = calculatePressureDrop(rows, channel);

  if (ctx.state.targetPressure !== null && Number.isFinite(ctx.state.targetPressure)) {
    ctx.state.targetDrop = calculatePressureDrop(rows, channel, {
      targetPressure: ctx.state.targetPressure
    });
  } else {
    ctx.state.targetDrop = null;
  }

  ctx.state.holdResult = evaluateHoldPeriod(rows, channel, {
    targetPressure: ctx.state.targetPressure ?? undefined,
    maxDropPct: ctx.state.maxDropPct
  });
}

function timeTextToMsOnLogDate(timeText: string, rows: PressureRow[]): number | null {
  if (rows.length === 0) return null;
  const parsed = parseTimeParts(timeText);
  if (!parsed) return null;
  // Use the first row's date as the canonical date for time-only inputs.
  // This works for single-day logs (the canonical fixture pattern). For
  // multi-day logs, the first occurrence wins — documented limitation.
  const iso = rows[0].localIso;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return toDeterministicTimestampMs({ year, month, day, ...parsed });
}

function qs<T extends HTMLElement>(root: HTMLElement, testId: string): T | null {
  return root.querySelector<T>(`[data-testid="${testId}"]`);
}
