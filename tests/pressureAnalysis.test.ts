import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import {
  selectRowsInTimeRange,
  calculatePressureDrop
} from '../src/domain/pressureAnalysis';
import type { PressureRow } from '../src/domain/types';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
const parsed = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });

describe('selectRowsInTimeRange', () => {
  it('returns all rows when both bounds are omitted', () => {
    const out = selectRowsInTimeRange(parsed.rows);
    expect(out).toHaveLength(parsed.rows.length);
    expect(out).not.toBe(parsed.rows); // new array
  });

  it('honors inclusive lower bound', () => {
    const cutoff = parsed.rows[10].timestampMs;
    const out = selectRowsInTimeRange(parsed.rows, cutoff);
    expect(out[0].timestampMs).toBe(cutoff);
    expect(out).toHaveLength(parsed.rows.length - 10);
  });

  it('honors inclusive upper bound', () => {
    const cutoff = parsed.rows[10].timestampMs;
    const out = selectRowsInTimeRange(parsed.rows, undefined, cutoff);
    expect(out[out.length - 1].timestampMs).toBe(cutoff);
    expect(out).toHaveLength(11);
  });

  it('returns empty array when from > to', () => {
    const out = selectRowsInTimeRange(parsed.rows, 1000, 500);
    expect(out).toHaveLength(0);
  });

  it('returns empty array on empty input', () => {
    const out = selectRowsInTimeRange([], 0, 1000);
    expect(out).toHaveLength(0);
  });

  it('does not mutate input array', () => {
    const before = parsed.rows.length;
    selectRowsInTimeRange(parsed.rows, 0, Date.UTC(3000, 0, 1));
    expect(parsed.rows.length).toBe(before);
  });
});

describe('calculatePressureDrop on canonical fixture', () => {
  it('computes T2 over the full fixture (positive drop)', () => {
    const drop = calculatePressureDrop(parsed.rows, 'p2');
    expect(drop.errors).toHaveLength(0);
    expect(drop.channel).toBe('p2');
    expect(drop.rowsUsed).toBe(461);
    expect(drop.startPressure).toBeCloseTo(314.386993, 6);
    expect(drop.endPressure).toBeCloseTo(299.279053, 6);
    expect(drop.dropBar).toBeCloseTo(15.107940, 6);
    expect(drop.durationMinutes).toBeCloseTo(69.4, 1);
    expect(drop.dropBarPerMinute).toBeCloseTo(0.217694, 5);
    expect(drop.dropBarPerHour).toBeCloseTo(13.061620, 4);
    // Default reference is start (314.386993) → dropPct ≈ 4.81%
    expect(drop.referencePressure).toBeCloseTo(314.386993, 6);
    expect(drop.dropPct).toBeCloseTo(0.048055, 5);
  });

  it('computes T1 over the full fixture (negative drop = pressure increased)', () => {
    const drop = calculatePressureDrop(parsed.rows, 'p1');
    expect(drop.errors).toHaveLength(0);
    expect(drop.channel).toBe('p1');
    expect(drop.rowsUsed).toBe(461);
    expect(drop.startPressure).toBeCloseTo(-2.958707, 6);
    expect(drop.endPressure).toBeCloseTo(-2.044990, 6);
    expect(drop.dropBar).toBeCloseTo(-0.913717, 6);
    expect(drop.durationMinutes).toBeCloseTo(69.4, 1);
    // Pressure increased over the period — dropPct must be NEGATIVE.
    // Math.abs(reference) keeps dropPct sign aligned with dropBar.
    expect(drop.dropPct).toBeCloseTo(-0.308823, 5);
  });

  it('uses options.targetPressure when supplied (T2 against 300 bar)', () => {
    const drop = calculatePressureDrop(parsed.rows, 'p2', { targetPressure: 300 });
    expect(drop.referencePressure).toBe(300);
    // dropBar / 300 = 15.107940 / 300 = 0.050360
    expect(drop.dropPct).toBeCloseTo(0.050360, 5);
  });

  it('falls back to startPressure when targetPressure is omitted', () => {
    const drop = calculatePressureDrop(parsed.rows, 'p2');
    expect(drop.referencePressure).toBe(drop.startPressure);
  });

  it('respects time-range filtering via selectRowsInTimeRange', () => {
    const tenMinAfterStart = parsed.rows[0].timestampMs + 10 * 60_000;
    const sub = selectRowsInTimeRange(parsed.rows, parsed.rows[0].timestampMs, tenMinAfterStart);
    const drop = calculatePressureDrop(sub, 'p2');
    expect(drop.errors).toHaveLength(0);
    expect(drop.durationMinutes).toBeLessThanOrEqual(10);
    expect(drop.durationMinutes).toBeGreaterThan(0);
    expect(drop.rowsUsed).toBeGreaterThanOrEqual(2);
  });
});

describe('calculatePressureDrop edge cases', () => {
  it('errors with NO_VALID_ROWS on empty input', () => {
    const drop = calculatePressureDrop([], 'p2');
    expect(drop.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
    expect(drop.dropBar).toBeNull();
    expect(drop.dropPct).toBeNull();
    expect(drop.rowsUsed).toBe(0);
  });

  it('errors with INSUFFICIENT_POINTS when only one valid row', () => {
    const single: PressureRow[] = [{ ...parsed.rows[0] }];
    const drop = calculatePressureDrop(single, 'p2');
    expect(drop.errors.some((e) => e.code === 'INSUFFICIENT_POINTS')).toBe(true);
    expect(drop.rowsUsed).toBe(1);
    expect(drop.dropBar).toBeNull();
  });

  it('errors with CHANNEL_NOT_PRESENT when all chosen-channel values are null', () => {
    const allNullP2: PressureRow[] = parsed.rows.slice(0, 5).map((r) => ({ ...r, p2: null }));
    const drop = calculatePressureDrop(allNullP2, 'p2');
    expect(drop.errors.some((e) => e.code === 'CHANNEL_NOT_PRESENT')).toBe(true);
  });

  it('skips null channel values silently when computing the other channel', () => {
    // p1 stays valid, p2 has nulls — p1 calculation should ignore that.
    const someP2Null: PressureRow[] = parsed.rows.map((r, i) =>
      i % 3 === 0 ? { ...r, p2: null } : { ...r }
    );
    const dropP1 = calculatePressureDrop(someP2Null, 'p1');
    expect(dropP1.errors).toHaveLength(0);
    expect(dropP1.rowsUsed).toBe(461);
  });

  it('errors with ZERO_DURATION when first and last valid rows share the timestamp', () => {
    const ts = parsed.rows[0].timestampMs;
    const dup: PressureRow[] = [
      { ...parsed.rows[0], timestampMs: ts, p2: 100 },
      { ...parsed.rows[1], timestampMs: ts, p2: 95 }
    ];
    const drop = calculatePressureDrop(dup, 'p2');
    expect(drop.errors.some((e) => e.code === 'ZERO_DURATION')).toBe(true);
    expect(drop.dropBar).toBeCloseTo(5, 6);
    expect(drop.dropBarPerMinute).toBeNull();
  });

  it('errors with INVALID_REFERENCE when targetPressure is exactly 0', () => {
    const drop = calculatePressureDrop(parsed.rows, 'p2', { targetPressure: 0 });
    expect(drop.errors.some((e) => e.code === 'INVALID_REFERENCE')).toBe(true);
    expect(drop.dropPct).toBeNull();
    // dropBar should still be computed
    expect(drop.dropBar).toBeCloseTo(15.107940, 6);
  });

  it('handles negative reference via Math.abs for dropPct sign', () => {
    // Synthetic: reference = -10, dropBar = -2 (pressure increased).
    // Without abs, dropPct = -2 / -10 = 0.2 (looks like a 20% drop).
    // With abs,    dropPct = -2 / 10 = -0.2 (correctly signed: increase).
    const synth: PressureRow[] = [
      { ...parsed.rows[0], timestampMs: 0, p2: -10 },
      { ...parsed.rows[1], timestampMs: 60_000, p2: -8 }
    ];
    const drop = calculatePressureDrop(synth, 'p2');
    expect(drop.dropBar).toBeCloseTo(-2, 6);
    expect(drop.dropPct).toBeCloseTo(-0.2, 6);
  });
});

describe('analysis purity: no UI/runtime imports in src/domain', () => {
  it('pressureAnalysis.ts does not import or reference forbidden libs', () => {
    const src = readFileSync('src/domain/pressureAnalysis.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"](?:electron|chart\.js|chartjs|chartjs-[a-z-]+|jspdf|hammerjs|papaparse)/i);
    expect(src).not.toMatch(/\brequire\(\s*['"](?:electron|chart\.js|chartjs|jspdf|papaparse|hammerjs)/i);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });
});
