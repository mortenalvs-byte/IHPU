import { describe, it, expect } from 'vitest';
import {
  captureChartImage,
  type ChartImageSource
} from '../src/charts/captureChart';

// Structural-typing fakes — we deliberately do NOT instantiate Chart.js or
// jsdom here. The capture helper is a pure adapter that takes anything with
// the two methods below and produces a structured payload for the PDF
// builder. Real PressureChart satisfies this interface by virtue of having
// `toBase64Image()` and `getCanvasDimensions()`.

function makeFake(
  toBase64Image: () => string | null,
  getCanvasDimensions: () => { widthPx: number; heightPx: number } | null
): ChartImageSource {
  return { toBase64Image, getCanvasDimensions };
}

const SAMPLE_DATA_URL = 'data:image/png;base64,abcdef';

describe('captureChartImage', () => {
  it('returns null when toBase64Image returns null', () => {
    const fake = makeFake(
      () => null,
      () => ({ widthPx: 800, heightPx: 400 })
    );
    expect(captureChartImage(fake)).toBeNull();
  });

  it('returns null when toBase64Image returns an empty string', () => {
    const fake = makeFake(
      () => '',
      () => ({ widthPx: 800, heightPx: 400 })
    );
    expect(captureChartImage(fake)).toBeNull();
  });

  it('returns null when canvas dimensions are null', () => {
    const fake = makeFake(
      () => SAMPLE_DATA_URL,
      () => null
    );
    expect(captureChartImage(fake)).toBeNull();
  });

  it('returns null when canvas dimensions are zero', () => {
    const fake = makeFake(
      () => SAMPLE_DATA_URL,
      () => ({ widthPx: 0, heightPx: 0 })
    );
    expect(captureChartImage(fake)).toBeNull();
  });

  it('returns null when only width is non-positive', () => {
    const fake = makeFake(
      () => SAMPLE_DATA_URL,
      () => ({ widthPx: -1, heightPx: 400 })
    );
    expect(captureChartImage(fake)).toBeNull();
  });

  it('returns the structured payload when both signals are present', () => {
    const fake = makeFake(
      () => SAMPLE_DATA_URL,
      () => ({ widthPx: 800, heightPx: 400 })
    );
    expect(captureChartImage(fake)).toEqual({
      dataUrl: SAMPLE_DATA_URL,
      widthPx: 800,
      heightPx: 400
    });
  });

  it('passes through arbitrary canvas dimensions verbatim', () => {
    const fake = makeFake(
      () => SAMPLE_DATA_URL,
      () => ({ widthPx: 1234, heightPx: 567 })
    );
    expect(captureChartImage(fake)).toEqual({
      dataUrl: SAMPLE_DATA_URL,
      widthPx: 1234,
      heightPx: 567
    });
  });

  it('does not throw when toBase64Image throws (defensive — caller decides)', () => {
    const fake = makeFake(
      () => {
        throw new Error('canvas not ready');
      },
      () => ({ widthPx: 800, heightPx: 400 })
    );
    // We do NOT swallow exceptions inside captureChartImage — that's the
    // caller's responsibility (handleExportPdf wraps the whole export in
    // a try/catch). This test documents the contract.
    expect(() => captureChartImage(fake)).toThrow(/canvas not ready/);
  });
});
