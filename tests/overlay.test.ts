import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  buildOverlayEntry,
  computeOverlayComparison,
  generateOverlayEntryId,
  type OverlayEntry
} from '../src/domain/overlay';
import type { HoldPeriodCriteria } from '../src/domain/types';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf-8');

const DEFAULT_CRITERIA: HoldPeriodCriteria = { maxDropPct: 5 };

function buildOk(filename: string, text: string, options?: Partial<Parameters<typeof buildOverlayEntry>[0]>) {
  const result = buildOverlayEntry({
    filename,
    fileText: text,
    addedAtMs: 1700000000000,
    criteria: DEFAULT_CRITERIA,
    ...options
  });
  if (!result.ok) {
    throw new Error(
      `expected buildOverlayEntry to succeed but got ${result.reason}: ${result.message}`
    );
  }
  return result.entry;
}

describe('buildOverlayEntry: canonical fixture (Dekk test Seal T.2)', () => {
  it('produces a parseable overlay entry with 461 rows and no parser errors', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.parseResult.rows.length).toBe(461);
    expect(entry.parseResult.meta.parsedRows).toBe(461);
    expect(entry.parseResult.errors).toHaveLength(0);
  });

  it('reports both T1 and T2 channels present', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.parseResult.meta.channelsPresent.p1).toBe(true);
    expect(entry.parseResult.meta.channelsPresent.p2).toBe(true);
    expect(entry.p1).not.toBeNull();
    expect(entry.p2).not.toBeNull();
  });

  it('matches the existing primary-pipeline T2 drop figures', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.p2!.pressureSummary.dropBar).not.toBeNull();
    expect(entry.p2!.pressureSummary.dropPct).not.toBeNull();
    expect(entry.p2!.pressureSummary.dropBar!).toBeCloseTo(15.107940, 4);
    expect(entry.p2!.pressureSummary.dropPct!).toBeCloseTo(4.8055, 3);
  });

  it('matches the existing primary-pipeline T1 increase (negative dropPct)', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.p1!.pressureSummary.dropBar).not.toBeNull();
    expect(entry.p1!.pressureSummary.dropPct).not.toBeNull();
    // T1 rises ~0.91 bar across the fixture; pressureSummary.dropBar < 0 because
    // start - end is negative when pressure increases. dropPct uses Math.abs of
    // the reference, so dropPct is also negative.
    expect(entry.p1!.pressureSummary.dropBar!).toBeCloseTo(-0.913717, 4);
    expect(entry.p1!.pressureSummary.dropPct!).toBeLessThan(0);
  });

  it('produces a PASS T2 verdict against default 5 % criteria (4.8055 % < 5 %)', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.p2!.holdPeriod.status).toBe('PASS');
  });

  it('produces a PASS T1 verdict because pressure rose (negative dropPct vs positive threshold)', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    expect(entry.p1!.holdPeriod.status).toBe('PASS');
  });

  it('uses the supplied filename and addedAtMs verbatim', () => {
    const entry = buildOk('My Custom Test.txt', FIXTURE_TEXT, {
      addedAtMs: 1700000000000
    });
    expect(entry.filename).toBe('My Custom Test.txt');
    expect(entry.addedAtMs).toBe(1700000000000);
  });

  it('honours an explicit overlay id', () => {
    const entry = buildOk('Dekk test Seal T.2', FIXTURE_TEXT, { id: 'oe_test_fixed' });
    expect(entry.id).toBe('oe_test_fixed');
  });

  it('generates an id that includes timestamp and sanitised filename when none is supplied', () => {
    const entry = buildOk('A B!@#$%^&.txt', FIXTURE_TEXT, { addedAtMs: 1700000000123 });
    expect(entry.id.startsWith('oe_1700000000123_')).toBe(true);
    expect(/^oe_\d+_\d+_[A-Za-z0-9_-]+$/.test(entry.id)).toBe(true);
  });

  it('tightening maxDropPct to 4 flips T2 verdict to FAIL', () => {
    const result = buildOverlayEntry({
      filename: 'Dekk test Seal T.2',
      fileText: FIXTURE_TEXT,
      addedAtMs: 1700000000000,
      criteria: { maxDropPct: 4 }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.p2!.holdPeriod.status).toBe('FAIL');
  });

  it('targetPressure = 315 changes the T2 dropPct without disturbing dropBar', () => {
    const baseline = buildOk('Dekk test Seal T.2', FIXTURE_TEXT);
    const withTarget = buildOverlayEntry({
      filename: 'Dekk test Seal T.2',
      fileText: FIXTURE_TEXT,
      addedAtMs: 1700000000000,
      criteria: { maxDropPct: 5, targetPressure: 315 }
    });
    expect(withTarget.ok).toBe(true);
    if (!withTarget.ok) return;
    expect(withTarget.entry.p2!.pressureSummary.dropBar!).toBeCloseTo(
      baseline.p2!.pressureSummary.dropBar!,
      6
    );
    expect(withTarget.entry.p2!.pressureSummary.dropPct!).toBeCloseTo(4.7962, 3);
  });
});

describe('buildOverlayEntry: failure paths', () => {
  it('returns EMPTY_TEXT for empty input without throwing', () => {
    const result = buildOverlayEntry({
      filename: 'empty.txt',
      fileText: '',
      addedAtMs: 1700000000000,
      criteria: DEFAULT_CRITERIA
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('EMPTY_TEXT');
    expect(result.message).toMatch(/tomt/i);
    expect(result.parseResult).toBeUndefined();
  });

  it('returns EMPTY_TEXT for whitespace-only input', () => {
    const result = buildOverlayEntry({
      filename: 'whitespace.txt',
      fileText: '   \r\n\t\n   ',
      addedAtMs: 1700000000000,
      criteria: DEFAULT_CRITERIA
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('EMPTY_TEXT');
  });

  it('returns PARSE_FAILED for input that the parser rejects entirely', () => {
    const result = buildOverlayEntry({
      filename: 'bad.txt',
      fileText: 'this is not a pressure log\nrandom garbage line',
      addedAtMs: 1700000000000,
      criteria: DEFAULT_CRITERIA
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Parser reports lines as MALFORMED_LINE / INVALID_TIMESTAMP, never throws.
    expect(['PARSE_FAILED', 'NO_VALID_ROWS']).toContain(result.reason);
    expect(result.parseResult).toBeDefined();
    expect(result.parseResult?.rows.length).toBe(0);
  });

  it('does not throw when fileText is undefined', () => {
    const result = buildOverlayEntry({
      filename: 'undef.txt',
      // @ts-expect-error — testing a non-string defensively (e.g. an unexpected null from a future caller).
      fileText: undefined,
      addedAtMs: 1700000000000,
      criteria: DEFAULT_CRITERIA
    });
    expect(result.ok).toBe(false);
  });
});

describe('computeOverlayComparison', () => {
  function entry(filename: string, addedAtMs: number, criteria?: HoldPeriodCriteria): OverlayEntry {
    return buildOk(filename, FIXTURE_TEXT, { addedAtMs, criteria });
  }

  it('returns an empty comparison for zero entries', () => {
    const cmp = computeOverlayComparison([], DEFAULT_CRITERIA);
    expect(cmp.entryCount).toBe(0);
    expect(cmp.entries).toEqual([]);
    expect(cmp.bestT2DropPctEntryId).toBeNull();
    expect(cmp.worstT2DropPctEntryId).toBeNull();
    expect(cmp.channelsPresentAny).toEqual({ p1: false, p2: false });
    expect(cmp.incomparableCount).toBe(0);
  });

  it('marks a single entry as best (not also worst) when only one is comparable', () => {
    const cmp = computeOverlayComparison([entry('one.txt', 1)], DEFAULT_CRITERIA);
    expect(cmp.entryCount).toBe(1);
    expect(cmp.bestT2DropPctEntryId).toBe(cmp.entries[0].id);
    expect(cmp.worstT2DropPctEntryId).toBeNull();
    expect(cmp.entries[0].isBestT2DropPct).toBe(true);
    expect(cmp.entries[0].isWorstT2DropPct).toBe(false);
  });

  it('preserves entry order verbatim', () => {
    const a = entry('a.txt', 1);
    const b = entry('b.txt', 2);
    const c = entry('c.txt', 3);
    const cmp = computeOverlayComparison([a, b, c], DEFAULT_CRITERIA);
    expect(cmp.entries.map((e) => e.filename)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('does not mutate the input entries array', () => {
    const list: OverlayEntry[] = [entry('a.txt', 1), entry('b.txt', 2)];
    const snapshot = [...list];
    computeOverlayComparison(list, DEFAULT_CRITERIA);
    expect(list).toEqual(snapshot);
  });

  it('does not mutate any individual OverlayEntry', () => {
    const e = entry('only.txt', 7);
    const beforeRows = e.parseResult.rows.length;
    const beforeP1 = e.p1?.holdPeriod.status;
    const beforeP2 = e.p2?.holdPeriod.status;
    computeOverlayComparison([e], { maxDropPct: 4 }); // tighter criteria — reflects only in vm
    expect(e.parseResult.rows.length).toBe(beforeRows);
    expect(e.p1?.holdPeriod.status).toBe(beforeP1);
    expect(e.p2?.holdPeriod.status).toBe(beforeP2);
  });

  it('recomputes verdicts against the supplied criteria, ignoring upload-time criteria', () => {
    // Built with PASS at 5%, view-modeled at 4% — verdict in vm should be FAIL.
    const e = entry('a.txt', 1, { maxDropPct: 5 });
    expect(e.p2!.holdPeriod.status).toBe('PASS'); // upload-time
    const cmp = computeOverlayComparison([e], { maxDropPct: 4 });
    expect(cmp.entries[0].p2!.verdict).toBe('FAIL');
  });

  it('flags both best and worst when there are two distinct comparable entries', () => {
    // We build two identical entries (same fixture) so dropPct is the same.
    // To produce DIFFERENT comparable T2 dropPct values, we apply different
    // targetPressure criteria via a per-entry fake by hand-constructing a
    // synthetic entry with a known channel summary. Easier: build twice from
    // the same fixture but vary criteria so that the SHARED computeOverlay-
    // Comparison call ranks both — they will tie. Instead, we'll vary
    // targetPressure during compute via a partition: but compute uses ONE
    // criteria for ALL entries. Use ONE criteria (default) and inject
    // synthetic OverlayEntries with different parseResults to force distinct
    // dropPct.
    const a = entry('low.txt', 1);
    const b = entry('high.txt', 2);

    // Create a synthetic high-drop entry by patching the second entry's
    // p2 summary. computeOverlayComparison ignores the entry-cached summary
    // and reruns analysis — so to force a difference we need a different
    // parseResult. Use a tiny synthetic CSV-like payload that yields a
    // larger drop.
    const syntheticBigDrop: OverlayEntry = {
      ...b,
      parseResult: {
        ...b.parseResult,
        rows: [
          // First row: high pressure
          { ...b.parseResult.rows[0], p2: 320 },
          // Last row: dropped to 280 — 12.5 % drop in the same time window
          {
            ...b.parseResult.rows[b.parseResult.rows.length - 1],
            p2: 280
          }
        ],
        meta: {
          ...b.parseResult.meta,
          parsedRows: 2
        }
      }
    };

    const cmp = computeOverlayComparison([a, syntheticBigDrop], DEFAULT_CRITERIA);
    // a has the smaller drop (~4.8 %), synthetic has the bigger (12.5 %).
    expect(cmp.bestT2DropPctEntryId).toBe(a.id);
    expect(cmp.worstT2DropPctEntryId).toBe(syntheticBigDrop.id);
    expect(cmp.entries[0].isBestT2DropPct).toBe(true);
    expect(cmp.entries[0].isWorstT2DropPct).toBe(false);
    expect(cmp.entries[1].isBestT2DropPct).toBe(false);
    expect(cmp.entries[1].isWorstT2DropPct).toBe(true);
  });

  it('counts entries whose T2 dropPct is null as incomparable, without breaking ranking', () => {
    const a = entry('a.txt', 1);
    // Synthetic entry with no T2 channel — channelsPresent.p2 false.
    const noP2: OverlayEntry = {
      ...a,
      id: 'oe_no_p2',
      parseResult: {
        ...a.parseResult,
        meta: {
          ...a.parseResult.meta,
          channelsPresent: { p1: true, p2: false }
        }
      },
      p2: null
    };
    const cmp = computeOverlayComparison([a, noP2], DEFAULT_CRITERIA);
    expect(cmp.incomparableCount).toBe(1);
    expect(cmp.bestT2DropPctEntryId).toBe(a.id);
    expect(cmp.worstT2DropPctEntryId).toBeNull(); // only one comparable entry
  });

  it('aggregates channelsPresentAny from all entries', () => {
    const a = entry('a.txt', 1);
    const cmp = computeOverlayComparison([a], DEFAULT_CRITERIA);
    expect(cmp.channelsPresentAny.p1).toBe(true);
    expect(cmp.channelsPresentAny.p2).toBe(true);
  });
});

describe('generateOverlayEntryId', () => {
  it('produces ids in the expected format', () => {
    const id = generateOverlayEntryId('My File.txt', 1700000000123);
    expect(/^oe_1700000000123_\d+_My_File_txt$/.test(id)).toBe(true);
  });

  it('includes a monotonic counter so two ids in the same ms do not collide', () => {
    const a = generateOverlayEntryId('same.txt', 1700000000000);
    const b = generateOverlayEntryId('same.txt', 1700000000000);
    expect(a).not.toBe(b);
  });

  it('sanitises non-alphanumeric characters in the filename', () => {
    const id = generateOverlayEntryId('rød/blå:test #1.txt', 1700000000000);
    // Norwegian chars and slashes get replaced with underscores; alphanumerics remain.
    expect(/[^A-Za-z0-9_-]/.test(id)).toBe(false);
  });
});
