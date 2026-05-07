# Pressure analysis & hold-period contract

`src/domain/pressureAnalysis.ts` and `src/domain/holdPeriod.ts` extend the
parser layer with two purely numeric concerns:

1. **Pressure-drop analysis** — given a `PressureRow[]` and a channel, compute
   start/end pressure, drop, drop %, bar/min, bar/hour, and a structured set of
   warnings/errors.
2. **Hold-period evaluation** — given the same row list, channel, and a
   `HoldPeriodCriteria`, compute the drop AND attach a PASS / FAIL / UNKNOWN
   verdict.

Both modules consume `PressureRow` (parser output) and produce structured
result objects. They never read files, draw charts, render PDFs, or write CSVs.
Everything that comes after this layer (charts, CSV, PDF, dashboard widgets)
must consume these results — they may not re-derive numbers from raw rows.

## Public API

### `selectRowsInTimeRange(rows, fromTimestampMs?, toTimestampMs?)`

Returns a new shallow copy of `rows` filtered to those whose `timestampMs`
falls in `[fromTimestampMs, toTimestampMs]` (inclusive, either bound optional).

- Empty input → empty output, no error.
- `from > to` → empty output, no error.
- Input is never mutated.

### `calculatePressureDrop(rows, channel, options?)`

Returns `PressureDropResult`:

| Field | Meaning |
|---|---|
| `channel` | Echoed input. |
| `rowsUsed` | Number of rows whose chosen channel value was numeric. Nulls are skipped silently. |
| `startPressure` / `endPressure` | First/last numeric value in the channel. |
| `startTimestampMs` / `endTimestampMs` | First/last timestamps (deterministic Date.UTC keys from the parser). |
| `referencePressure` | `options.targetPressure` if provided, else `startPressure`. |
| `durationMinutes` | `(endTimestampMs - startTimestampMs) / 60000`. |
| `dropBar` | `startPressure - endPressure`. **Positive** = pressure dropped. **Negative** = pressure increased over the period. |
| `dropPct` | `dropBar / Math.abs(referencePressure)`. **Math.abs is intentional** — see below. |
| `dropBarPerMinute` / `dropBarPerHour` | Linear rates. |
| `errors` / `warnings` | Structured `AnalysisIssue[]`. Function never throws. |

#### Why `Math.abs` on the reference

The canonical fixture's T1 channel is negative across all 461 rows. If we used
the raw negative reference, dividing a negative `dropBar` by a negative
reference would flip the sign — pressure that physically went UP would report
as a positive drop %. `Math.abs(referencePressure)` keeps `dropPct`'s sign
aligned with `dropBar`'s sign:

| `startPressure` | `endPressure` | `dropBar` | `referencePressure` | `dropPct` (with abs) |
|---|---|---|---|---|
| 314 | 299 | +15 | 314 | +0.048 (4.8% drop) |
| 314 | 320 | -6 | 314 | -0.019 (1.9% increase) |
| -3 | -2 | -1 | -3 | -0.333 (33.3% increase) |
| -3 | -4 | +1 | -3 | +0.333 (33.3% drop) |

This is the semantic the dashboard, CSV, and PDF layers will all assume.

#### Error codes

| Code | Severity | When |
|---|---|---|
| `NO_VALID_ROWS` | error | `rows.length === 0` |
| `CHANNEL_NOT_PRESENT` | error | All rows have `null` for the chosen channel. |
| `INSUFFICIENT_POINTS` | error | Only one valid row — can't compute drop or rates. |
| `ZERO_DURATION` | error | First and last valid rows share a timestamp; rates undefined. |
| `INVALID_REFERENCE` | error | `targetPressure === 0`; can't divide. |

### `evaluateHoldPeriod(rows, channel, criteria)`

Returns `HoldPeriodResult` with `status: 'PASS' | 'FAIL' | 'UNKNOWN'`.

Algorithm:

1. Validate the time range. If `from > to` → record `INVALID_RANGE` error.
2. Select rows in the range via `selectRowsInTimeRange`.
3. Run `calculatePressureDrop` with `targetPressure ← criteria.targetPressure`.
4. Determine status:
   - `UNKNOWN` if `criteria.maxDropPct` is undefined (with `MISSING_CRITERIA` warning).
   - `UNKNOWN` if any error from steps 1–3 (`NO_VALID_ROWS`, `INSUFFICIENT_POINTS`,
     `ZERO_DURATION`, `CHANNEL_NOT_PRESENT`, `INVALID_REFERENCE`, `INVALID_RANGE`).
   - `PASS` if `drop.dropPct <= criteria.maxDropPct`.
   - `FAIL` if `drop.dropPct > criteria.maxDropPct`.

`maxDropPct` is fractional (`0.05` = 5 %), not percent-typed. The test suite
covers PASS at the exact threshold.

A negative `dropPct` (pressure increased over the period) automatically
satisfies any positive `maxDropPct` — that's the desired semantic for hold
tests: "pressure didn't drop more than X" is trivially true if pressure went up.

The result echoes the input `criteria` back so downstream consumers (CSV/PDF)
can reproduce the calculation deterministically.

## Canonical fixture expectations (encoded in tests)

These are the deterministic numbers `npm test` asserts against
`test-data/Dekk test Seal T.2`. They serve as the contract the analysis layer
must satisfy on every commit.

| Channel | start | end | dropBar | dropPct (no target) | bar/min | bar/hour |
|---|---|---|---|---|---|---|
| T2 (`p2`) | 314.386993 | 299.279053 | +15.107940 | +0.048055 | +0.217694 | +13.061620 |
| T1 (`p1`) | -2.958707 | -2.044990 | -0.913717 | -0.308823 | -0.013166 | -0.789957 |

Duration over the full fixture: ≈ 69.4 min (4164 seconds).

## What the analysis layer does NOT do

- Does not filter rows by pressure threshold (e.g. "T2 > 10 bar"). That belongs
  to a higher layer that picks the hold candidate before calling these
  functions.
- Does not detect or score multiple hold candidates within a single log. A
  caller wanting "find the best hold window" composes
  `selectRowsInTimeRange` + `evaluateHoldPeriod` with its own search policy.
- Does not modify `PressureRow` objects.
- Does not throw. Every degenerate case is reflected in `errors` / `warnings`
  with a structured `AnalysisIssueCode` so a UI can render a precise message.
- Does not know about Chart.js, jsPDF, CSV, file dialogs, or the renderer.

## Downstream consumers (planned)

- `src/charts/pressureChart.ts` — visualises `rows` plus optionally annotates
  the active `PressureDropResult` (start/end markers, hold range).
- `src/reports/csvExport.ts` — exports `rows` AND the analysis result it was
  evaluated against, never re-deriving numbers.
- `src/reports/pdfReport.ts` — same: consumes `HoldPeriodResult`, renders
  PASS/FAIL with the exact same numbers the dashboard shows.
