import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

// Canonical raw fixture v1. See docs/development/test-data-contract.md.
// These values are the contract — every parser, analysis, chart, and report
// implementation that lands in this repo must work against this exact file.
const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');
const EXPECTED_SIZE = 19266;
const EXPECTED_SHA256 = '8e44d28b0a295b9dbb8fecb202c8e899f8f3b6291a886128b9b22f6e6b12ca22';

describe('fixture integrity: test-data/Dekk test Seal T.2', () => {
  it('exists at canonical path', () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });

  it(`is exactly ${EXPECTED_SIZE} bytes`, () => {
    expect(statSync(FIXTURE_PATH).size).toBe(EXPECTED_SIZE);
  });

  it('matches canonical sha256', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    expect(sha256).toBe(EXPECTED_SHA256);
  });

  it('contains more than 10 non-empty lines', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const nonEmpty = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(nonEmpty.length).toBeGreaterThan(10);
  });

  it('looks like a tab-separated trykktest log with DD.MM.YYYY timestamps', () => {
    const text = readFileSync(FIXTURE_PATH, 'utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    const tabbedLines = lines.filter((l) => l.includes('\t'));
    expect(tabbedLines.length).toBeGreaterThan(10);

    const datedLine = lines.find((l) => /^\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}/.test(l));
    expect(datedLine).toBeDefined();

    const cells = datedLine!.split('\t');
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });
});
