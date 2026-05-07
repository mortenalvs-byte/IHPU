// PressureChart — Chart.js wiring for IHPU trykktest logs.
//
// This module is the renderer/UI layer. It does not own AppState. The owner
// (events.ts) instantiates a PressureChart, calls `setData()` when a parse
// completes, and subscribes to `onPeriodSelected` to receive drag-select
// events. The chart never recomputes pressure metrics on its own — analysis
// belongs to the domain layer.
//
// No domain imports here other than the read-only PressureRow shape.

import {
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
  type ChartConfiguration,
  type Plugin
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { PressureRow } from '../domain/types';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin
);

export interface SelectedRange {
  fromMs: number;
  toMs: number;
}

export interface ChartCallbacks {
  /**
   * Called after a drag-select gesture completes. The fromMs/toMs are
   * normalised so fromMs <= toMs, both in deterministic Date.UTC ms.
   */
  onPeriodSelected: (range: SelectedRange) => void;
}

const T1_COLOR = '#41d8ff';
const T2_COLOR = '#ff8a41';
const T1_FILL = 'rgba(65, 216, 255, 0.08)';
const T2_FILL = 'rgba(255, 138, 65, 0.08)';
const SELECTION_FILL = 'rgba(102, 227, 164, 0.18)';
const SELECTION_STROKE = 'rgba(102, 227, 164, 0.85)';
const DRAG_PREVIEW_FILL = 'rgba(65, 216, 255, 0.18)';
const DRAG_PREVIEW_STROKE = 'rgba(65, 216, 255, 0.7)';

const MIN_DRAG_PIXELS = 5;

export class PressureChart {
  private chart: Chart | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: ChartCallbacks;
  private selectedRange: SelectedRange | null = null;
  private dragStartPx: number | null = null;
  private dragCurrentPx: number | null = null;
  private readonly mouseUpHandler: (e: MouseEvent) => void;

  constructor(canvas: HTMLCanvasElement, callbacks: ChartCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.mouseUpHandler = (e) => this.handleMouseUp(e);
    this.attachDragHandlers();
  }

  /**
   * Replace any existing chart with one rendering the supplied rows.
   * Safe to call repeatedly — the previous chart is destroyed first.
   */
  setData(rows: PressureRow[]): void {
    this.destroy();
    if (rows.length === 0) return;

    const p1Data = rows
      .filter((r) => r.p1 !== null && Number.isFinite(r.p1))
      .map((r) => ({ x: r.timestampMs, y: r.p1 as number }));
    const p2Data = rows
      .filter((r) => r.p2 !== null && Number.isFinite(r.p2))
      .map((r) => ({ x: r.timestampMs, y: r.p2 as number }));

    const datasets: ChartConfiguration<'line'>['data']['datasets'] = [];
    if (p1Data.length > 0) {
      datasets.push({
        label: 'T1',
        data: p1Data,
        borderColor: T1_COLOR,
        backgroundColor: T1_FILL,
        pointRadius: 0,
        borderWidth: 1.4,
        spanGaps: false,
        tension: 0
      });
    }
    if (p2Data.length > 0) {
      datasets.push({
        label: 'T2',
        data: p2Data,
        borderColor: T2_COLOR,
        backgroundColor: T2_FILL,
        pointRadius: 0,
        borderWidth: 1.4,
        spanGaps: false,
        tension: 0
      });
    }

    const overlayPlugin: Plugin<'line'> = {
      id: 'period-overlay',
      afterDraw: (chart) => this.drawOverlay(chart)
    };

    this.chart = new Chart(this.canvas, {
      type: 'line',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: {
            type: 'time',
            time: {
              displayFormats: {
                second: 'HH:mm:ss',
                minute: 'HH:mm',
                hour: 'HH:mm'
              },
              tooltipFormat: 'yyyy-MM-dd HH:mm:ss'
            },
            ticks: { color: '#8aa0b8' },
            grid: { color: 'rgba(31, 42, 54, 0.6)' }
          },
          y: {
            title: { display: true, text: 'bar', color: '#8aa0b8' },
            ticks: { color: '#8aa0b8' },
            grid: { color: 'rgba(31, 42, 54, 0.6)' }
          }
        },
        plugins: {
          legend: { display: true, labels: { color: '#e6f1ff' } },
          tooltip: { mode: 'nearest', intersect: false },
          zoom: {
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              drag: { enabled: false },
              mode: 'x'
            },
            pan: {
              enabled: false
            }
          }
        }
      },
      plugins: [overlayPlugin]
    });
  }

  /**
   * Highlight a selected time range. Pass `null` to clear.
   */
  setSelectedRange(range: SelectedRange | null): void {
    this.selectedRange = range;
    this.chart?.update('none');
  }

  resetZoom(): void {
    if (this.chart) {
      this.chart.resetZoom();
    }
  }

  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  isReady(): boolean {
    return this.chart !== null;
  }

  // ---------- drag-select implementation ----------

  private attachDragHandlers(): void {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    // Listen on window so a drag that ends outside the canvas still resolves.
    window.addEventListener('mouseup', this.mouseUpHandler);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.chart) return;
    const px = this.eventOffsetX(e);
    if (px === null) return;
    this.dragStartPx = px;
    this.dragCurrentPx = px;
  }

  private handleMouseMove(e: MouseEvent): void {
    if (this.dragStartPx === null || !this.chart) return;
    const px = this.eventOffsetX(e);
    if (px === null) return;
    this.dragCurrentPx = px;
    this.chart.update('none');
  }

  private handleMouseUp(_e: MouseEvent): void {
    if (this.dragStartPx === null || !this.chart) {
      this.dragStartPx = null;
      this.dragCurrentPx = null;
      return;
    }
    const startPx = this.dragStartPx;
    const endPx = this.dragCurrentPx ?? startPx;
    this.dragStartPx = null;
    this.dragCurrentPx = null;

    if (Math.abs(endPx - startPx) < MIN_DRAG_PIXELS) {
      this.chart.update('none');
      return;
    }

    const xScale = this.chart.scales['x'];
    if (!xScale) {
      this.chart.update('none');
      return;
    }

    const fromMs = xScale.getValueForPixel(Math.min(startPx, endPx));
    const toMs = xScale.getValueForPixel(Math.max(startPx, endPx));

    if (
      fromMs !== undefined &&
      toMs !== undefined &&
      Number.isFinite(fromMs) &&
      Number.isFinite(toMs)
    ) {
      this.callbacks.onPeriodSelected({
        fromMs: Math.min(fromMs, toMs),
        toMs: Math.max(fromMs, toMs)
      });
    }
    this.chart.update('none');
  }

  private eventOffsetX(e: MouseEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (!Number.isFinite(px)) return null;
    return px;
  }

  // ---------- overlay rendering ----------

  private drawOverlay(chart: Chart): void {
    const { ctx, chartArea, scales } = chart;
    const xScale = scales['x'];

    // Drag-in-progress preview takes precedence visually.
    if (this.dragStartPx !== null && this.dragCurrentPx !== null) {
      const lo = Math.max(chartArea.left, Math.min(this.dragStartPx, this.dragCurrentPx));
      const hi = Math.min(chartArea.right, Math.max(this.dragStartPx, this.dragCurrentPx));
      ctx.save();
      ctx.fillStyle = DRAG_PREVIEW_FILL;
      ctx.fillRect(lo, chartArea.top, hi - lo, chartArea.bottom - chartArea.top);
      ctx.strokeStyle = DRAG_PREVIEW_STROKE;
      ctx.lineWidth = 1;
      ctx.strokeRect(lo, chartArea.top, hi - lo, chartArea.bottom - chartArea.top);
      ctx.restore();
      return;
    }

    if (!this.selectedRange || !xScale) return;

    const fromPx = xScale.getPixelForValue(this.selectedRange.fromMs);
    const toPx = xScale.getPixelForValue(this.selectedRange.toMs);
    if (!Number.isFinite(fromPx) || !Number.isFinite(toPx)) return;

    const lo = Math.max(chartArea.left, Math.min(fromPx, toPx));
    const hi = Math.min(chartArea.right, Math.max(fromPx, toPx));
    if (hi <= lo) return;

    ctx.save();
    ctx.fillStyle = SELECTION_FILL;
    ctx.fillRect(lo, chartArea.top, hi - lo, chartArea.bottom - chartArea.top);
    ctx.strokeStyle = SELECTION_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(lo, chartArea.top, hi - lo, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
}
