#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FIXTURE_PATH = path.join('test-data', 'Dekk test Seal T.2');

// Canonical raw fixture v1. Both values are part of the contract — see
// docs/development/test-data-contract.md. Changing either requires a deliberate
// fixture-contract PR, not a drive-by edit.
const EXPECTED_SIZE = 19266;
const EXPECTED_SHA256 = '8e44d28b0a295b9dbb8fecb202c8e899f8f3b6291a886128b9b22f6e6b12ca22';

const REPORT_DIR = 'test-results';
const REPORT_PATH = path.join(REPORT_DIR, 'fixture-integrity.json');

const errors = [];
const checks = [];

function check(label, ok, detail) {
  checks.push({ label, ok, detail });
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}: ${detail}`);
    errors.push(`${label}: ${detail}`);
  }
}

let buf;
try {
  buf = readFileSync(FIXTURE_PATH);
} catch (err) {
  console.error('FIXTURE INTEGRITY FAIL');
  console.error(`  cannot read ${FIXTURE_PATH}: ${err.message}`);
  process.exit(1);
}

const stat = statSync(FIXTURE_PATH);
const size = stat.size;
const sha256 = createHash('sha256').update(buf).digest('hex');

const text = buf.toString('utf-8');
const allLines = text.split(/\r?\n/);
const lineCount = allLines.length;
const nonEmptyLines = allLines.filter((l) => l.trim().length > 0);
const nonEmptyCount = nonEmptyLines.length;
const tabbedLines = nonEmptyLines.filter((l) => l.includes('\t'));
const tabbedCount = tabbedLines.length;
const datedLine = nonEmptyLines.find((l) => /^\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}/.test(l));

console.log(`Checking fixture: ${FIXTURE_PATH}`);
check('file is non-empty', size > 0, `got ${size} bytes`);
check(`size === ${EXPECTED_SIZE} bytes`, size === EXPECTED_SIZE, `got ${size}`);
check(`sha256 === ${EXPECTED_SHA256}`, sha256 === EXPECTED_SHA256, `got ${sha256}`);
check('non-empty line count > 10', nonEmptyCount > 10, `got ${nonEmptyCount}`);
check('contains at least one tab-separated line', tabbedCount > 0, `got ${tabbedCount}`);
check(
  'contains at least one DD.MM.YYYY HH:MM line',
  datedLine !== undefined,
  'no line matched DD.MM.YYYY HH:MM pattern'
);

const summary = {
  path: FIXTURE_PATH,
  expected: { size: EXPECTED_SIZE, sha256: EXPECTED_SHA256 },
  actual: { size, sha256, lineCount, nonEmptyCount, tabbedCount },
  passed: errors.length === 0,
  errors,
  checks,
  checkedAt: new Date().toISOString()
};

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2) + '\n');

if (errors.length > 0) {
  console.error('SMOKE FIXTURE FAIL');
  console.error(`  ${errors.length} check(s) failed`);
  console.error(`  see ${REPORT_PATH}`);
  process.exit(1);
}

console.log('SMOKE FIXTURE PASS');
console.log(`  size:           ${size} bytes`);
console.log(`  sha256:         ${sha256}`);
console.log(`  total lines:    ${lineCount}`);
console.log(`  non-empty:      ${nonEmptyCount}`);
console.log(`  tab-separated:  ${tabbedCount}`);
console.log(`  report:         ${REPORT_PATH}`);
