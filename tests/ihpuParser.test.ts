import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseIhpuPressureLog } from '../src/domain/ihpuParser';
import {
  parseDateParts,
  parseTimeParts,
  parseIhpuLocalDateTime,
  toLocalIso,
  toDeterministicTimestampMs,
  formatDurationMinutes
} from '../src/utils/dateTime';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');

describe('parseIhpuPressureLog: canonical fixture (Dekk test Seal T.2)', () => {
  const fixtureText = readFileSync(FIXTURE_PATH, 'utf-8');
  const result = parseIhpuPressureLog(fixtureText, { sourceName: 'Dekk test Seal T.2' });

  it('parses 461 rows with no errors', () => {
    expect(result.rows.length).toBe(461);
    expect(result.errors).toHaveLength(0);
    expect(result.meta.parsedRows).toBe(461);
    expect(result.meta.nonEmptyLines).toBe(461);
    expect(result.meta.skippedLines).toBe(0);
  });

  it('records source name and totalLines including trailing CRLF empty', () => {
    expect(result.meta.sourceName).toBe('Dekk test Seal T.2');
    // 461 data lines + 1 empty trailing line from final CRLF = 462
    expect(result.meta.totalLines).toBe(462);
  });

  it('reports both channels present', () => {
    expect(result.meta.channelsPresent.p1).toBe(true);
    expect(result.meta.channelsPresent.p2).toBe(true);
  });

  it('preserves exact first row values', () => {
    const first = result.rows[0];
    expect(first.dateText).toBe('21.02.2026');
    expect(first.timeText).toBe('13:10:37');
    expect(first.p1).not.toBeNull();
    expect(first.p2).not.toBeNull();
    expect(first.p1!).toBeCloseTo(-2.958707, 6);
    expect(first.p2!).toBeCloseTo(314.386993, 6);
    expect(first.localIso).toBe('2026-02-21T13:10:37');
    expect(first.tMinutes).toBe(0);
  });

  it('preserves exact last row values', () => {
    const last = result.rows[result.rows.length - 1];
    expect(last.dateText).toBe('21.02.2026');
    expect(last.timeText).toBe('14:20:01');
    expect(last.p1).not.toBeNull();
    expect(last.p2).not.toBeNull();
    expect(last.p1!).toBeCloseTo(-2.044990, 6);
    expect(last.p2!).toBeCloseTo(299.279053, 6);
    expect(last.localIso).toBe('2026-02-21T14:20:01');
  });

  it('calculates deterministic duration close to 69.4 minutes', () => {
    expect(result.rows[0].tMinutes).toBe(0);
    const last = result.rows[result.rows.length - 1];
    expect(last.tMinutes).toBeCloseTo(69.4, 1);
    expect(result.meta.durationMinutes).toBeCloseTo(69.4, 1);
  });

  it('uses Date.UTC for the canonical timestampMs', () => {
    // Independent of host timezone — must match Date.UTC verbatim.
    const expectedFirst = Date.UTC(2026, 1, 21, 13, 10, 37);
    const expectedLast = Date.UTC(2026, 1, 21, 14, 20, 1);
    expect(result.rows[0].timestampMs).toBe(expectedFirst);
    expect(result.rows[result.rows.length - 1].timestampMs).toBe(expectedLast);
    expect(result.meta.firstTimestampMs).toBe(expectedFirst);
    expect(result.meta.lastTimestampMs).toBe(expectedLast);
  });

  it('preserves all-negative T1 channel without warnings about negative values', () => {
    const allNegative = result.rows.every((r) => r.p1 !== null && (r.p1 as number) < 0);
    expect(allNegative).toBe(true);
    const negativeWarnings = result.warnings.filter((w) => /negative/i.test(w.message));
    expect(negativeWarnings).toHaveLength(0);
  });

  it('preserves negative T2 values where present', () => {
    const negT2 = result.rows.filter((r) => r.p2 !== null && (r.p2 as number) < 0);
    expect(negT2.length).toBeGreaterThan(0);
  });

  it('computes channel stats matching the fixture contract', () => {
    const p1 = result.meta.channelStats.p1;
    expect(p1.count).toBe(461);
    expect(p1.nullCount).toBe(0);
    expect(p1.min).not.toBeNull();
    expect(p1.max).not.toBeNull();
    expect(p1.min!).toBeCloseTo(-3.306789, 5);
    expect(p1.max!).toBeCloseTo(-1.631642, 5);
    expect(p1.first!).toBeCloseTo(-2.958707, 6);
    expect(p1.last!).toBeCloseTo(-2.044990, 6);

    const p2 = result.meta.channelStats.p2;
    expect(p2.count).toBe(461);
    expect(p2.nullCount).toBe(0);
    expect(p2.min!).toBeCloseTo(-3.560973, 5);
    expect(p2.max!).toBeCloseTo(342.787537, 5);
    expect(p2.first!).toBeCloseTo(314.386993, 6);
    expect(p2.last!).toBeCloseTo(299.279053, 6);
  });

  it('produces no UNSORTED_INPUT warning on the canonical fixture (already ascending)', () => {
    const unsorted = result.warnings.filter((w) => w.code === 'UNSORTED_INPUT');
    expect(unsorted).toHaveLength(0);
  });
});

describe('parseIhpuPressureLog: synthetic inputs', () => {
  it('supports CRLF line endings', () => {
    const input =
      '21.02.2026 13:10:37\t-2.5\t314.0\r\n' + '21.02.2026 13:10:44\t-2.6\t313.5\r\n';
    const r = parseIhpuPressureLog(input);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
  });

  it('supports LF line endings', () => {
    const input = '21.02.2026 13:10:37\t-2.5\t314.0\n' + '21.02.2026 13:10:44\t-2.6\t313.5\n';
    const r = parseIhpuPressureLog(input);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
  });

  it('supports decimal comma in numeric fields', () => {
    const input = '21.02.2026 13:10:37\t-2,5\t314,25\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).not.toBeNull();
    expect(r.rows[0].p2).not.toBeNull();
    expect(r.rows[0].p1!).toBeCloseTo(-2.5, 6);
    expect(r.rows[0].p2!).toBeCloseTo(314.25, 6);
  });

  it('warns and nulls T2 when missing, but keeps the row', () => {
    const input = '21.02.2026 13:10:37\t-2.5\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).toBeCloseTo(-2.5, 6);
    expect(r.rows[0].p2).toBeNull();
    expect(r.warnings.some((w) => w.code === 'MISSING_VALUE' && w.field === 'p2')).toBe(true);
  });

  it('warns and nulls invalid number, but keeps the row', () => {
    const input = '21.02.2026 13:10:37\tnotnum\t314.0\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).toBeNull();
    expect(r.rows[0].p2).toBeCloseTo(314.0, 6);
    expect(r.warnings.some((w) => w.code === 'INVALID_NUMBER' && w.field === 'p1')).toBe(true);
  });

  it('errors on invalid timestamp and skips the row', () => {
    const input = 'not-a-timestamp\t-2.5\t314.0\n' + '21.02.2026 13:10:37\t-2.6\t313.5\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].dateText).toBe('21.02.2026');
    expect(r.errors.some((e) => e.code === 'INVALID_TIMESTAMP')).toBe(true);
    expect(r.meta.skippedLines).toBe(1);
  });

  it('returns NO_VALID_ROWS for empty input (also reports EMPTY_INPUT)', () => {
    const r = parseIhpuPressureLog('');
    expect(r.rows).toHaveLength(0);
    expect(r.errors.some((e) => e.code === 'EMPTY_INPUT')).toBe(true);
    expect(r.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });

  it('returns NO_VALID_ROWS for invalid-only input', () => {
    const r = parseIhpuPressureLog('garbage line\nanother garbage\n');
    expect(r.rows).toHaveLength(0);
    expect(r.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });

  it('sorts unsorted input ascending and emits UNSORTED_INPUT warning', () => {
    const input =
      '21.02.2026 13:11:00\t-2.6\t313.5\n' + '21.02.2026 13:10:37\t-2.5\t314.0\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].timeText).toBe('13:10:37');
    expect(r.rows[1].timeText).toBe('13:11:00');
    expect(r.warnings.some((w) => w.code === 'UNSORTED_INPUT')).toBe(true);
  });

  it('warns on extra columns but keeps the first three', () => {
    const input = '21.02.2026 13:10:37\t-2.5\t314.0\textra\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).toBeCloseTo(-2.5, 6);
    expect(r.rows[0].p2).toBeCloseTo(314.0, 6);
    expect(r.warnings.some((w) => w.code === 'EXTRA_COLUMNS')).toBe(true);
  });

  it('falls back to whitespace splitting when the line has no tab', () => {
    const input = '21.02.2026 13:10:37 -2.5 314.0\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).toBeCloseTo(-2.5, 6);
    expect(r.rows[0].p2).toBeCloseTo(314.0, 6);
  });

  it('preserves source order via stable sort when timestamps tie', () => {
    const input =
      '21.02.2026 13:10:37\t-2.5\t100.0\n' + '21.02.2026 13:10:37\t-2.6\t101.0\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].sourceLine).toBe(1);
    expect(r.rows[1].sourceLine).toBe(2);
  });

  it('does not warn or null negative pressure values', () => {
    const input = '21.02.2026 13:10:37\t-100.0\t-50.0\n';
    const r = parseIhpuPressureLog(input);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].p1).toBeCloseTo(-100.0, 6);
    expect(r.rows[0].p2).toBeCloseTo(-50.0, 6);
    expect(r.warnings).toHaveLength(0);
  });

  it('supports DD/MM/YYYY and YYYY-MM-DD date formats', () => {
    const r1 = parseIhpuPressureLog('21/02/2026 13:10:37\t-2.5\t100.0\n');
    expect(r1.rows).toHaveLength(1);
    expect(r1.rows[0].dateText).toBe('21/02/2026');

    const r2 = parseIhpuPressureLog('2026-02-21 13:10:37\t-2.5\t100.0\n');
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].dateText).toBe('2026-02-21');
  });

  it('supports HH:MM time without seconds', () => {
    const r = parseIhpuPressureLog('21.02.2026 13:10\t-2.5\t100.0\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].timeText).toBe('13:10');
    // localIso always emits HH:MM:SS form
    expect(r.rows[0].localIso).toBe('2026-02-21T13:10:00');
  });
});

describe('parser purity: no UI/runtime imports in the domain layer', () => {
  it('src/domain/ihpuParser.ts does not import or reference forbidden libs', () => {
    const src = readFileSync('src/domain/ihpuParser.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"](?:electron|chart\.js|chartjs|chartjs-[a-z-]+|jspdf|hammerjs|papaparse)/i);
    expect(src).not.toMatch(/\brequire\(\s*['"](?:electron|chart\.js|chartjs|jspdf|papaparse|hammerjs)/i);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });

  it('src/domain/types.ts does not import or reference forbidden libs', () => {
    const src = readFileSync('src/domain/types.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"](?:electron|chart\.js|chartjs|chartjs-[a-z-]+|jspdf|hammerjs|papaparse)/i);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });

  it('src/utils/dateTime.ts does not import or reference forbidden libs', () => {
    const src = readFileSync('src/utils/dateTime.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"](?:electron|chart\.js|chartjs|chartjs-[a-z-]+|jspdf|hammerjs|papaparse)/i);
    expect(src).not.toMatch(/\bdocument\b/);
    expect(src).not.toMatch(/\bwindow\b/);
  });
});

describe('dateTime helpers', () => {
  it('parseDateParts accepts DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD', () => {
    expect(parseDateParts('21.02.2026')).toEqual({ year: 2026, month: 2, day: 21 });
    expect(parseDateParts('21/02/2026')).toEqual({ year: 2026, month: 2, day: 21 });
    expect(parseDateParts('2026-02-21')).toEqual({ year: 2026, month: 2, day: 21 });
  });

  it('parseDateParts rejects impossible calendar dates', () => {
    expect(parseDateParts('30.02.2026')).toBeNull(); // Feb 30
    expect(parseDateParts('31.04.2026')).toBeNull(); // Apr 31
    expect(parseDateParts('00.01.2026')).toBeNull();
    expect(parseDateParts('01.13.2026')).toBeNull();
  });

  it('parseTimeParts accepts HH:MM and HH:MM:SS, rejects out-of-range', () => {
    expect(parseTimeParts('13:10')).toEqual({ hour: 13, minute: 10, second: 0 });
    expect(parseTimeParts('13:10:37')).toEqual({ hour: 13, minute: 10, second: 37 });
    expect(parseTimeParts('25:00')).toBeNull();
    expect(parseTimeParts('12:60')).toBeNull();
    expect(parseTimeParts('12:00:60')).toBeNull();
  });

  it('parseIhpuLocalDateTime handles canonical fixture format', () => {
    const dt = parseIhpuLocalDateTime('21.02.2026 13:10:37');
    expect(dt).toEqual({ year: 2026, month: 2, day: 21, hour: 13, minute: 10, second: 37 });
  });

  it('toLocalIso pads correctly', () => {
    expect(toLocalIso({ year: 2026, month: 2, day: 1, hour: 5, minute: 7, second: 9 })).toBe(
      '2026-02-01T05:07:09'
    );
  });

  it('toDeterministicTimestampMs is host-TZ independent', () => {
    const ms = toDeterministicTimestampMs({
      year: 2026,
      month: 2,
      day: 21,
      hour: 13,
      minute: 10,
      second: 37
    });
    expect(ms).toBe(Date.UTC(2026, 1, 21, 13, 10, 37));
  });

  it('formatDurationMinutes prints one decimal', () => {
    expect(formatDurationMinutes(69.45)).toBe('69.5 min');
    expect(formatDurationMinutes(0)).toBe('0.0 min');
  });
});
