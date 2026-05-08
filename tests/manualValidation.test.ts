import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseManualPaste,
  validateManualRows
} from '../src/manual/manualValidation';
import {
  _resetRowIdCounterForTests,
  newManualRow
} from '../src/manual/manualTypes';

beforeEach(() => {
  _resetRowIdCounterForTests();
});

describe('validateManualRows: per-row validation', () => {
  it('accepts a row with valid date, time, and both channels', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '-2.96', p2Text: '314.39' })
    ];
    const r = validateManualRows(rows);
    expect(r.errors).toHaveLength(0);
    expect(r.validRowCount).toBe(1);
  });

  it('accepts YYYY-MM-DD as well as DD.MM.YYYY', () => {
    const r1 = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '0', p2Text: '0' })
    ]);
    const r2 = validateManualRows([
      newManualRow({ dateText: '2026-02-21', timeText: '13:10:37', p1Text: '0', p2Text: '0' })
    ]);
    expect(r1.errors).toHaveLength(0);
    expect(r2.errors).toHaveLength(0);
  });

  it('rejects invalid date with INVALID_DATE error', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '32.13.2026', timeText: '13:10:37', p1Text: '1', p2Text: '2' })
    ]);
    expect(r.errors.some((e) => e.code === 'INVALID_DATE')).toBe(true);
    expect(r.validRowCount).toBe(0);
  });

  it('rejects invalid time with INVALID_TIME error', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '25:00', p1Text: '1', p2Text: '2' })
    ]);
    expect(r.errors.some((e) => e.code === 'INVALID_TIME')).toBe(true);
  });

  it('rejects invalid number with INVALID_NUMBER error and field hint', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: 'abc', p2Text: '314' })
    ]);
    const issue = r.errors.find((e) => e.code === 'INVALID_NUMBER');
    expect(issue).toBeDefined();
    expect(issue?.field).toBe('p1');
  });

  it('accepts negative pressure values without complaint', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '-100', p2Text: '-50' })
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.validRowCount).toBe(1);
  });

  it('accepts decimal comma alongside decimal point', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '-2,96', p2Text: '314,39' })
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.validRowCount).toBe(1);
  });

  it('accepts a row with only T1 (T2 missing)', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '-2.5', p2Text: '' })
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.validRowCount).toBe(1);
  });

  it('accepts a row with only T2 (T1 missing)', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '', p2Text: '314.5' })
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.validRowCount).toBe(1);
  });

  it('rejects a row with both channels empty as NO_CHANNELS', () => {
    const r = validateManualRows([
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '', p2Text: '' })
    ]);
    expect(r.errors.some((e) => e.code === 'NO_CHANNELS')).toBe(true);
    expect(r.validRowCount).toBe(0);
  });

  it('treats a fully-blank row as EMPTY_ROW', () => {
    const r = validateManualRows([newManualRow({})]);
    expect(r.errors.some((e) => e.code === 'EMPTY_ROW')).toBe(true);
  });
});

describe('validateManualRows: cross-row checks', () => {
  it('warns on duplicate timestamps but does not invalidate the rows', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '1', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:37', p1Text: '2', p2Text: '299' })
    ];
    const r = validateManualRows(rows);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === 'DUPLICATE_TIMESTAMP')).toBe(true);
    expect(r.validRowCount).toBe(2);
  });

  it('warns when rows are not in ascending time order', () => {
    const rows = [
      newManualRow({ dateText: '21.02.2026', timeText: '13:11:00', p1Text: '1', p2Text: '300' }),
      newManualRow({ dateText: '21.02.2026', timeText: '13:10:00', p1Text: '2', p2Text: '299' })
    ];
    const r = validateManualRows(rows);
    expect(r.warnings.some((w) => w.code === 'UNSORTED')).toBe(true);
  });

  it('reports NO_VALID_ROWS when every row is invalid', () => {
    const rows = [
      newManualRow({ dateText: 'bad', timeText: 'bad', p1Text: 'x', p2Text: 'y' })
    ];
    const r = validateManualRows(rows);
    expect(r.errors.some((e) => e.code === 'NO_VALID_ROWS')).toBe(true);
  });
});

describe('parseManualPaste', () => {
  it('imports tab-separated lines with combined date+time', () => {
    const text = '21.02.2026 13:10:37\t-2.96\t314.39\n21.02.2026 13:10:44\t-2.97\t314.10\n';
    const r = parseManualPaste(text);
    expect(r.imported).toBe(2);
    expect(r.rejected).toBe(0);
    expect(r.rows[0]?.dateText).toBe('21.02.2026');
    expect(r.rows[0]?.timeText).toBe('13:10:37');
    expect(r.rows[0]?.p1Text).toBe('-2.96');
    expect(r.rows[0]?.p2Text).toBe('314.39');
  });

  it('imports tab-separated lines with date and time as separate fields', () => {
    const text = '21.02.2026\t13:10:37\t-2.96\t314.39\n';
    const r = parseManualPaste(text);
    expect(r.imported).toBe(1);
    expect(r.rejected).toBe(0);
    expect(r.rows[0]?.dateText).toBe('21.02.2026');
    expect(r.rows[0]?.timeText).toBe('13:10:37');
  });

  it('falls back to whitespace-separated when no tabs are present', () => {
    const text = '21.02.2026 13:10:37 -2.96 314.39\n';
    const r = parseManualPaste(text);
    expect(r.imported).toBe(1);
    expect(r.rows[0]?.p1Text).toBe('-2.96');
  });

  it('skips blank lines silently', () => {
    const text = '\n\n21.02.2026 13:10:37\t-2.96\t314.39\n\n';
    const r = parseManualPaste(text);
    expect(r.imported).toBe(1);
  });

  it('reports per-line issues for malformed lines', () => {
    const text = 'this is garbage\n21.02.2026 13:10:37\t-2.96\t314.39\n';
    const r = parseManualPaste(text);
    expect(r.rejected).toBeGreaterThan(0);
    expect(r.imported).toBe(1);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('preserves negative values via paste', () => {
    const text = '21.02.2026 13:10:37\t-100.5\t-50.25\n';
    const r = parseManualPaste(text);
    expect(r.rows[0]?.p1Text).toBe('-100.5');
    expect(r.rows[0]?.p2Text).toBe('-50.25');
  });
});
