import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
const parsed = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });

describe('evaluateHoldPeriod on canonical fixture', () => {
  it('returns UNKNOWN when maxDropPct is missing (no threshold to compare)', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {});
    expect(result.status).toBe('UNKNOWN');
    expect(result.warnings.some((w) => w.code === 'MISSING_CRITERIA')).toBe(true);
    // Underlying drop calc still ran successfully.
    expect(result.drop.errors).toHaveLength(0);
    expect(result.drop.dropBar).toBeCloseTo(15.107940, 6);
  });

  it('returns FAIL when T2 drop (~4.8%) exceeds maxDropPct of 1', () => {
    // maxDropPct is in PERCENT POINTS — 1 means 1 %, not 0.01.
    const result = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: 1 });
    expect(result.status).toBe('FAIL');
    expect(result.drop.dropPct!).toBeGreaterThan(1);
  });

  it('returns PASS when T2 drop (~4.8%) is below maxDropPct of 10', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: 10 });
    expect(result.status).toBe('PASS');
    expect(result.drop.dropPct!).toBeLessThan(10);
  });

  it('returns PASS for T1 (pressure increased) with any positive maxDropPct', () => {
    // T1 dropPct ≈ -30.88 percent points (negative because pressure went up).
    // PASS for any positive threshold.
    const result = evaluateHoldPeriod(parsed.rows, 'p1', { maxDropPct: 5 });
    expect(result.status).toBe('PASS');
    expect(result.drop.dropPct!).toBeLessThan(0);
  });

  it('forwards targetPressure to the drop calculation', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {
      targetPressure: 300,
      maxDropPct: 10
    });
    expect(result.drop.referencePressure).toBe(300);
    // (15.107940 / 300) * 100 = 5.04 percent points, still under 10.
    expect(result.status).toBe('PASS');
  });

  it('selects rows in the requested time range', () => {
    const fromMs = parsed.rows[0].timestampMs;
    const toMs = parsed.rows[10].timestampMs;
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {
      fromTimestampMs: fromMs,
      toTimestampMs: toMs,
      maxDropPct: 10
    });
    expect(result.drop.startTimestampMs).toBe(fromMs);
    expect(result.drop.endTimestampMs).toBe(toMs);
    expect(result.drop.rowsUsed).toBe(11);
  });

  it('echoes criteria back on the result for traceability', () => {
    const criteria = {
      fromTimestampMs: parsed.rows[5].timestampMs,
      toTimestampMs: parsed.rows[20].timestampMs,
      targetPressure: 320,
      maxDropPct: 5
    };
    const result = evaluateHoldPeriod(parsed.rows, 'p2', criteria);
    expect(result.criteria).toEqual(criteria);
    expect(result.channel).toBe('p2');
  });
});

describe('evaluateHoldPeriod edge cases', () => {
  it('returns UNKNOWN when from > to (invalid range)', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {
      fromTimestampMs: 1_000_000,
      toTimestampMs: 0,
      maxDropPct: 0.05
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.errors.some((e) => e.code === 'INVALID_RANGE')).toBe(true);
  });

  it('returns UNKNOWN with empty range warning when no rows match', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {
      fromTimestampMs: Date.UTC(3000, 0, 1),
      toTimestampMs: Date.UTC(3000, 0, 2),
      maxDropPct: 0.05
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.warnings.some((w) => w.code === 'EMPTY_RANGE')).toBe(true);
    expect(result.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });

  it('returns UNKNOWN when zero rows are provided', () => {
    const result = evaluateHoldPeriod([], 'p2', { maxDropPct: 0.05 });
    expect(result.status).toBe('UNKNOWN');
    expect(result.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });

  it('returns UNKNOWN when targetPressure is 0', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', {
      targetPressure: 0,
      maxDropPct: 0.05
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.errors.some((e) => e.code === 'INVALID_REFERENCE')).toBe(true);
  });

  it('preserves the underlying drop result inside the hold-period result', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: 0.10 });
    expect(result.drop.channel).toBe('p2');
    expect(result.drop.startPressure).toBeCloseTo(314.386993, 6);
    expect(result.drop.endPressure).toBeCloseTo(299.279053, 6);
    expect(result.drop.dropBar).toBeCloseTo(15.107940, 6);
  });

  it('PASS at the exact threshold (dropPct === maxDropPct)', () => {
    const result = evaluateHoldPeriod(parsed.rows, 'p2', { maxDropPct: expectedDropPctPercent(parsed.rows) });
    expect(result.status).toBe('PASS');
  });
});

// Helper: pre-compute T2 dropPct (in PERCENT POINTS) from the full fixture so
// we can test the boundary condition (PASS when dropPct === maxDropPct).
function expectedDropPctPercent(rows: ReturnType<typeof parseIhpuPressureLog>['rows']): number {
  const first = rows[0].p2!;
  const last = rows[rows.length - 1].p2!;
  return ((first - last) / Math.abs(first)) * 100;
}

describe('holdPeriod purity: no UI/runtime imports in src/domain', () => {
  it('holdPeriod.ts does not import or reference forbidden libs', () => {
    const src = readFileSync('src/domain/holdPeriod.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"](?:electron|chart\.js|chartjs|chartjs-[a-z-]+|jspdf|hammerjs|papaparse)/i);
    expect(src).not.toMatch(/\brequire\(\s*['"](?:electron|chart\.js|chartjs|jspdf|papaparse|hammerjs)/i);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });
});
