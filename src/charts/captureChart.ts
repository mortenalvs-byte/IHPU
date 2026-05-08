// captureChart.ts — adapter that turns a chart-image source into the structured
// payload the PDF report layer consumes.
//
// The function deliberately accepts a structural interface rather than the
// concrete `PressureChart` class, so it stays unit-testable without mounting
// Chart.js inside jsdom (Chart.js requires a real canvas 2D context that
// jsdom only partially implements). PressureChart satisfies the interface
// by virtue of having `toBase64Image` and `getCanvasDimensions` methods.

export interface ChartImageSource {
  /** Return a `data:image/png;base64,...` URL, or null when the chart is not ready. */
  toBase64Image(): string | null;
  /** Return the actual pixel dimensions of the canvas, or null when the chart is not ready. */
  getCanvasDimensions(): { widthPx: number; heightPx: number } | null;
}

export interface ChartImage {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Capture the chart as a base64 PNG plus its pixel dimensions. Returns null
 * if the chart is not ready (no data mounted yet) or the canvas reports
 * non-positive dimensions. Never throws.
 */
export function captureChartImage(source: ChartImageSource): ChartImage | null {
  const dataUrl = source.toBase64Image();
  if (!dataUrl) return null;
  const dims = source.getCanvasDimensions();
  if (!dims) return null;
  if (dims.widthPx <= 0 || dims.heightPx <= 0) return null;
  return { dataUrl, widthPx: dims.widthPx, heightPx: dims.heightPx };
}
