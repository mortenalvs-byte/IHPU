# Test data contract

The `test-data/` directory holds **canonical raw fixtures** — real pressure logs that
every parser, analysis, chart, and report in this repo must interoperate with. These
fixtures are immutable truth: they are the ground we build on, and the only way the
project ever gets a "did this PR break our real customer scenario?" answer for free.

## Canonical raw fixture v1

| Field | Value |
|---|---|
| Path | `test-data/Dekk test Seal T.2` |
| Size | `19266` bytes |
| sha256 | `8e44d28b0a295b9dbb8fecb202c8e899f8f3b6291a886128b9b22f6e6b12ca22` |
| Encoding | UTF-8, CRLF line endings |
| Format | Tab-separated `DD.MM.YYYY HH:MM:SS<TAB>T1<TAB>T2`, ~2,700 rows |

These two values (size + sha256) are encoded as constants in:

- `scripts/check-fixture.mjs` — the `smoke:fixture` gate
- `tests/fixtureIntegrity.test.ts` — the Vitest gate that runs as part of `npm test`

They are also documented here so a reviewer can verify the contract by inspection.

## Why this fixture is locked

Trykktest analysis produces numbers that customers act on (pass/fail decisions on
seals, tires, pressure vessels). If the parser silently changes how it reads the
fixture between versions, downstream charts, CSV exports, and PDF reports change
silently with it. Locking the fixture means:

- Any change to byte content forces a deliberate fixture-contract PR with a written
  rationale (e.g. "we're adding a malformed-row scenario, here's why").
- Every parser change can be measured against fixed inputs, so regressions show up as
  diffs in the test output instead of hiding in production data.
- Reviewers can assert that "this PR did not change the canonical inputs" by reading
  one diff.

## Don't edit in place

Do **not** save edits to `test-data/Dekk test Seal T.2` from a text editor, do **not**
re-export it from the source application, do **not** "fix" the line endings or
"clean up" trailing whitespace. The byte content is the contract.

If you need to add a new test scenario:

- Add a NEW file with a descriptive name (e.g. `test-data/Sjakt T-junction NoOk
  v1.txt`) — never overwrite the existing one.
- Add it to the `scripts/check-fixture.mjs` and `tests/fixtureIntegrity.test.ts`
  contracts with its own size + sha256.
- Bump the per-fixture version (`v1` → `v2`) only when you intentionally replace the
  canonical file, and document why in the same PR.

## What the fixture is NOT

- Not a synthetic regression input. We will add synthetic edge-case fixtures later
  (empty file, malformed rows, channel dropouts) under their own filenames. The v1
  canonical fixture is a real customer-shaped log.
- Not the place for generated output. PDFs, CSVs, screenshots, and JSON reports go to
  `test-results/` (gitignored) or, in production, to user-chosen paths. Never write
  to `test-data/`.
- Not a moving target. If you need a different fixture, add one — don't mutate this
  one.

## Verification gates

Two layers verify the fixture every time `npm run verify` runs:

1. **`npm test` → `tests/fixtureIntegrity.test.ts`** — Vitest assertions on existence,
   size, sha256, line count, and tabbed/timestamped structure. Runs as part of every
   unit test pass.
2. **`npm run smoke:fixture` → `scripts/check-fixture.mjs`** — same checks, plus a
   JSON summary written to `test-results/fixture-integrity.json`. Runs first in the
   `verify` chain so a corrupted fixture stops the chain before web/prod/electron
   smoke even spin up.

CI runs `npm run verify`, so any push or PR with a broken fixture fails before
review.

## When the contract intentionally changes

If a future PR genuinely needs to replace the canonical fixture (e.g. customer
provides a richer reference log):

1. Open the PR with title `data: rotate canonical fixture v1 → v2` (or similar).
2. Add the new file.
3. Update `EXPECTED_SIZE` and `EXPECTED_SHA256` in both `scripts/check-fixture.mjs`
   and `tests/fixtureIntegrity.test.ts`.
4. Update this document's "Canonical raw fixture" table to v2.
5. Run `npm run verify` to confirm the new contract holds.
6. In the PR description, explain WHY the fixture was rotated and what scenarios the
   new file covers that the old one didn't.

Anything less than this — silent edits, "tiny adjustments," normalising line
endings — is a contract violation and the verify gate will catch it.
