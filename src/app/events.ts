// events.ts — wires DOM inputs to AppState mutations and re-renders.
//
// File reading uses File.text() (browser/Electron renderer API). The parser
// and analysis modules are pure domain functions — they receive the text and
// return structured ParseResult / PressureDropResult / HoldPeriodResult.

import type { PressureChart, SelectedRange } from '../charts/pressureChart';
import { evaluateHoldPeriod } from '../domain/holdPeriod';
import { parseIhpuPressureLog } from '../domain/ihpuParser';
import { calculatePressureDrop } from '../domain/pressureAnalysis';
import type { PressureChannel, PressureRow } from '../domain/types';
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
}

async function handleFileSelected(ctx: AppContext, input: HTMLInputElement): Promise<void> {
  const file = input.files && input.files[0];
  if (!file) return;

  ctx.state.userMessage = null;
  ctx.state.chartError = null;
  ctx.state.selectedFileName = file.name;

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
    ctx.state.parseResult = parseIhpuPressureLog(text, { sourceName: file.name });
  } catch (err) {
    ctx.state.parseResult = null;
    ctx.state.userMessage = {
      severity: 'error',
      text: `Uventet parser-feil: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  recomputeAnalysis(ctx);

  // Mount chart with the freshly parsed data.
  if (ctx.state.parseResult && ctx.state.parseResult.rows.length > 0) {
    try {
      ctx.chart.setData(ctx.state.parseResult.rows);
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
  const rows = filterRowsToSelection(pr.rows, ctx.state);

  ctx.state.baselineDrop = calculatePressureDrop(rows, channel);

  if (ctx.state.targetPressure !== null && Number.isFinite(ctx.state.targetPressure)) {
    ctx.state.targetDrop = calculatePressureDrop(rows, channel, {
      targetPressure: ctx.state.targetPressure
    });
  } else {
    ctx.state.targetDrop = null;
  }

  ctx.state.holdResult = evaluateHoldPeriod(rows, channel, {
    fromTimestampMs: ctx.state.selectedFromTimestampMs ?? undefined,
    toTimestampMs: ctx.state.selectedToTimestampMs ?? undefined,
    targetPressure: ctx.state.targetPressure ?? undefined,
    maxDropPct: ctx.state.maxDropPct
  });
}

function filterRowsToSelection(rows: PressureRow[], state: AppState): PressureRow[] {
  const fromMs = state.selectedFromTimestampMs;
  const toMs = state.selectedToTimestampMs;
  if (fromMs === null && toMs === null) return rows;
  const lo = fromMs ?? Number.NEGATIVE_INFINITY;
  const hi = toMs ?? Number.POSITIVE_INFINITY;
  return rows.filter((r) => r.timestampMs >= lo && r.timestampMs <= hi);
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
