# IHPU pressure log parser — contract

`src/domain/ihpuParser.ts` is the canonical entry point for turning a raw IHPU
trykktest log into a structured `ParseResult`. Everything downstream (pressure
analysis, hold-period detection, charts, CSV, PDF) consumes the same
`ParseResult` so they cannot disagree on what "a row" means.

This document is the parser's API and behaviour contract. If you change the
parser, this file changes with it.

## Scope

- **Input:** raw text from an IHPU trykktest log.
- **Output:** [`ParseResult`](../../src/domain/types.ts) — `rows`, `issues`,
  `warnings`, `errors`, `meta`.
- **No IO:** the parser does not read files. Reading from disk, from a file
  picker, or from a fetch is the caller's job.
- **No DOM, no Electron, no Chart.js, no jsPDF, no PapaParse.** The parser must
  run unchanged in a browser bundle, an Electron renderer, and a Node-based
  Vitest test.
- **No analysis logic.** The parser does not know what a "hold period" is,
  what a target pressure is, or how to decide PASS/FAIL. That belongs to
  `src/domain/pressureAnalysis.ts` and `src/domain/holdPeriod.ts` (next PRs).

## Input format

Primary format — tab-separated, one row per line:

```
DD.MM.YYYY HH:MM:SS<TAB>T1<TAB>T2
```

The space between `DATE` and `TIME` is a literal space. The cell separator is
ASCII tab (`\t`). The canonical fixture (`test-data/Dekk test Seal T.2`) is in
this exact form with CRLF line endings.

### Date formats

- `DD.MM.YYYY` (canonical)
- `DD/MM/YYYY`
- `YYYY-MM-DD`

Impossible calendar dates (e.g. `30.02.2026`, `31.04.2026`) are rejected.

### Time formats

- `HH:MM:SS` (canonical)
- `HH:MM` (seconds default to 0)

Out-of-range values (e.g. `25:00`, `12:60`) are rejected.

### Number formats

- Decimal point: `314.386993`
- Decimal comma: `314,386993`

Both are accepted on a per-cell basis. Negative values are valid raw data and
are **never filtered**.

### Whitespace fallback

If a non-empty line contains no tab, the parser falls back to whitespace
splitting and expects four fields: `<date> <time> <T1> <T2>`. This exists for
hand-constructed test cases; the canonical fixture always has tabs.

## Canonical fixture expectations

These values are encoded as Vitest assertions in
[`tests/ihpuParser.test.ts`](../../tests/ihpuParser.test.ts) and verified end
to end by `npm run verify`.

| Field | Value |
|---|---|
| `meta.totalLines` | 462 (461 data lines + 1 trailing empty from the final CRLF) |
| `meta.nonEmptyLines` | 461 |
| `meta.parsedRows` / `rows.length` | 461 |
| `meta.skippedLines` | 0 |
| `errors.length` | 0 |
| `meta.channelsPresent` | `{ p1: true, p2: true }` |
| First row | `21.02.2026 13:10:37` &middot; T1 `-2.958707` &middot; T2 `314.386993` |
| Last row | `21.02.2026 14:20:01` &middot; T1 `-2.044990` &middot; T2 `299.279053` |
| `meta.durationMinutes` | ≈ 69.4 |
| `channelStats.p1.count` | 461 (all negative in this fixture) |
| `channelStats.p1.min` / `max` | ≈ `-3.306789` / `-1.631642` |
| `channelStats.p2.count` | 461 (mixed positive + small negative section) |
| `channelStats.p2.min` / `max` | ≈ `-3.560973` / `342.787537` |

## Timestamp rule (deterministic)

`PressureRow.timestampMs` is built with `Date.UTC(...)` from the parsed wall-clock
parts, **not** with `new Date(string)`. The value is not a UTC instant in the
wall-clock sense — it is an ordering surrogate that produces the same deltas
regardless of host timezone.

This matters because:

- IHPU log timestamps carry no timezone.
- Vitest, the renderer, and the Windows GitHub Actions runner all live in
  different effective timezones.
- Sorting and duration calculations must produce identical numbers everywhere.

`PressureRow.localIso` is the wall-clock string in ISO-8601 form
(`YYYY-MM-DDTHH:MM:SS`) with **no** timezone suffix, also for the same reason.

## Why negative values are preserved

In the canonical fixture, T1 is negative across all 461 rows and T2 contains a
short negative section near the end. Negative pressure readings are valid raw
data — for example, suction-side measurements during pump-down phases, or
calibration drift. The parser is not allowed to silently drop them.

Higher-level analysis modules may apply thresholds:

- A hold-zone detector might require `T2 > 10 bar` for at least N consecutive
  rows.
- A pass/fail check might compare drop-percentage against a target.

But those decisions belong upstairs. The parser's job is to surface the data
faithfully and let downstream code apply meaning.

## Issue model

`ParseResult.issues` is the chronological merged list of warnings and errors.
For convenience, `warnings` and `errors` are pre-filtered views of the same
underlying issues.

| Severity | Code | Effect on row | When emitted |
|---|---|---|---|
| `error` | `EMPTY_INPUT` | n/a | input was empty after trim |
| `error` | `MALFORMED_LINE` | row dropped | line could not be split into date+time |
| `error` | `INVALID_TIMESTAMP` | row dropped | timestamp didn't match any supported format |
| `error` | `NO_VALID_ROWS` | n/a | input had content but produced zero PressureRows |
| `warning` | `INVALID_NUMBER` | field set to null | T1 or T2 was non-numeric (negative is fine, "abc" is not) |
| `warning` | `MISSING_VALUE` | field set to null | T1 or T2 cell was missing or empty |
| `warning` | `EXTRA_COLUMNS` | first 3 (or 4 for whitespace) used | line had more cells than expected |
| `warning` | `UNSORTED_INPUT` | rows are sorted ascending | source order was not already monotonic |

Errors that carry a `line` of `0` apply to the input as a whole. Per-line
issues carry a 1-based line number that matches the original input.

## Sorting

By default the parser returns rows sorted ascending by `timestampMs`. When two
rows share the same timestamp, the original `sourceLine` ordering is preserved
(stable sort). If the source was already monotonic ascending, no warning is
emitted; if it wasn't, an `UNSORTED_INPUT` warning surfaces so downstream
code can decide whether to trust the original order.

`tMinutes` is computed **after** sorting, so the first emitted row always has
`tMinutes === 0` and subsequent rows have monotonically non-decreasing
`tMinutes`.

`ParseOptions.sortRows = false` opts out of sorting (rows are emitted in
source order). The `UNSORTED_INPUT` warning still surfaces in this case so the
caller knows the data was not monotonic.

## What the parser does not do

- Does not decide PASS/FAIL.
- Does not apply target pressure or max-drop criteria.
- Does not detect hold periods.
- Does not draw charts, render PDFs, or write CSVs.
- Does not filter, smooth, or interpolate values.
- Does not modify input — `PressureRow.raw` is the original line, untouched.
- Does not throw on malformed input — every error is surfaced via the issue
  list, so a caller can always distinguish "parser crashed" from "input was
  bad."

## Downstream consumers (planned, not yet implemented)

- `src/domain/pressureAnalysis.ts` — start/end pressure, drop, drop %, bar/min,
  bar/hour against a `ParseResult`.
- `src/domain/holdPeriod.ts` — detect candidate hold zones from `rows` plus a
  channel selection.
- `src/charts/pressureChart.ts` — Chart.js wiring that takes `rows` directly.
- `src/reports/csvExport.ts` and `src/reports/pdfReport.ts` — must consume the
  same analysis result the dashboard sees, never re-derive numbers from `rows`.

Each of those is a separate PR. Do not bundle them with parser changes.
