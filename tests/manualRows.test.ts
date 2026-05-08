import { describe, expect, it } from 'vitest';
import { calculatePressureDrop } from '../src/domain/pressureAnalysis';
import { evaluateHoldPeriod } from '../src/domain/holdPeriod';
import { buildManualParseResult } from '../src/manual/manualRows';
import { newManualRow } from '../src/manual/manualTypes';

describe('buildManualParseResult', () => {
  it('converts manual rows to a ParseResult with deterministic timestamps', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '-2.96', p2Text: '314.39' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:11:37', p1Text: '-2.95', p2Text: '314.20' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:12:37', p1Text: '-2.94', p2Text: '314.00' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.timestampMs).toBe(Date.UTC(2026, 1, 21, 13, 10, 37));
    expect(result.rows[2]!.timestampMs).toBe(Date.UTC(2026, 1, 21, 13, 12, 37));
    expect(result.meta.parsedRows).toBe(3);
  });

  it('sets tMinutes from the first valid row', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '-3', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:05:00', p1Text: '-3', p2Text: '299' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:00', p1Text: '-3', p2Text: '298' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.rows[0]!.tMinutes).toBe(0);
    expect(result.rows[1]!.tMinutes).toBeCloseTo(5, 6);
    expect(result.rows[2]!.tMinutes).toBeCloseTo(10, 6);
  });

  it('sorts unsorted input ascending and emits an UNSORTED_INPUT warning', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:11:00', p1Text: '0', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:00', p1Text: '0', p2Text: '301' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.rows[0]!.timeText).toBe('13:10:00');
    expect(result.rows[1]!.timeText).toBe('13:11:00');
    expect(result.warnings.some((w) => w.code === 'UNSORTED_INPUT')).toBe(true);
  });

  it('preserves negative pressure values', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '-100', p2Text: '-50' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:01:00', p1Text: '-99', p2Text: '-49' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.rows[0]!.p1).toBe(-100);
    expect(result.rows[0]!.p2).toBe(-50);
    // Should NOT emit any "negative" warnings; the analysis layer decides what's valid.
    expect(result.warnings.filter((w) => /negative/i.test(w.message))).toHaveLength(0);
  });

  it('produces a ParseResult that flows into calculatePressureDrop unchanged', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '0', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:30:00', p1Text: '0', p2Text: '285' })
    ];
    const result = buildManualParseResult(rows);
    const drop = calculatePressureDrop(result.rows, 'p2');
    expect(drop.errors).toHaveLength(0);
    expect(drop.startPressure).toBe(300);
    expect(drop.endPressure).toBe(285);
    expect(drop.dropBar).toBe(15);
    expect(drop.durationMinutes).toBe(30);
  });

  it('produces a ParseResult that flows into evaluateHoldPeriod with a verdict', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '0', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:30:00', p1Text: '0', p2Text: '285' })
    ];
    const result = buildManualParseResult(rows);
    const hold = evaluateHoldPeriod(result.rows, 'p2', { maxDropPct: 10 });
    expect(['PASS', 'FAIL', 'UNKNOWN']).toContain(hold.status);
    // 15 / 300 = 5 % drop, with maxDropPct=10 → PASS
    expect(hold.status).toBe('PASS');
  });

  it('returns NO_VALID_ROWS error when every manual row is invalid', () => {
    const rows = [
      newManualRow({ dateText: 'bad', timeText: 'bad', p1Text: 'x', p2Text: 'y' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });

  it('returns EMPTY_INPUT when called with no rows', () => {
    const result = buildManualParseResult([]);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.some((e) => e.code === 'EMPTY_INPUT')).toBe(true);
  });

  it('does not mutate the input rows array', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '0', p2Text: '300' })
    ];
    const before = JSON.parse(JSON.stringify(rows));
    buildManualParseResult(rows);
    expect(rows).toEqual(before);
  });

  it('uses a custom sourceName when supplied', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '0', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:01:00', p1Text: '0', p2Text: '299' })
    ];
    const result = buildManualParseResult(rows, 'My custom test');
    expect(result.meta.sourceName).toBe('My custom test');
  });

  it('builds channelsPresent correctly when rows have only one channel', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:00:00', p1Text: '', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:01:00', p1Text: '', p2Text: '299' })
    ];
    const result = buildManualParseResult(rows);
    expect(result.meta.channelsPresent.p1).toBe(false);
    expect(result.meta.channelsPresent.p2).toBe(true);
  });
});
