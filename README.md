# IHPU TrykkAnalyse

Pressure-test analysis desktop app (Windows). Built with Electron + Vite + TypeScript.

## Status

Bootstrap phase. The renderer currently shows a minimal "Bootstrap OK" shell. The original single-file web app is preserved at `legacy/IHPU_TrykkAnalyse.original.html`. Domain modules under `src/domain/`, `src/charts/`, and `src/reports/` are placeholders pending migration.

## Layout

```
electron/         Electron main + preload (TypeScript, compiled to dist-electron/)
src/
  app/            Renderer shell, state, events, render
  domain/         Pure logic: parser, pressure analysis, hold period
  charts/         Chart.js wiring
  reports/        CSV + PDF export
  styles/         CSS
  utils/          Date/time, sanitize
legacy/           Original HTML preserved verbatim
test-data/        Real trykktest sample (`Dekk test Seal T.2`)
tests/            Vitest tests for domain modules
```

## Development

```bash
npm install
npm run electron:dev
```

Or double-click `Start IHPU.bat` on the desktop.

## Build

```bash
npm run build       # renderer + electron compile
npm test            # vitest run
npm run dist        # full installer (electron-builder, NSIS target)
```

## Development verification

The preview/smoke harness lets every feature PR be verified deterministically before
review. See [docs/development/preview-and-smoke.md](docs/development/preview-and-smoke.md)
and [docs/development/test-data-contract.md](docs/development/test-data-contract.md)
for full details.

```bash
npm run smoke:fixture    # canonical raw fixture sha256 + size gate
npm run preview:web      # vite dev server on 127.0.0.1:5173
npm run preview:prod     # build + vite preview on 127.0.0.1:4173
npm run smoke:web        # headless dev smoke
npm run smoke:prod       # headless prod smoke (relative-asset bundle)
npm run smoke:electron   # Playwright Electron smoke against dist-electron/main.js
npm run verify           # build + test + fixture + all runtime smokes (PR gate)
```

`test-data/Dekk test Seal T.2` is the **canonical raw fixture** — its sha256 and size
are locked, and every parser/analysis/chart/report PR must work against it. Don't
edit the file in place; replacing it requires a deliberate fixture-contract PR.

`Start IHPU.bat` and the packaged Windows installer still need manual desktop testing
before any release — the harness covers ~80% of the app surface, not the OS shell.

## Parser contract

`src/domain/ihpuParser.ts` is the canonical entry point for turning raw IHPU
trykktest log text into a structured `ParseResult` (rows, issues, warnings,
errors, meta). Pure TypeScript, no DOM/Electron/Chart.js — runs in the
renderer, in tests, and (later) in the report exporters from the same source.

The canonical fixture `test-data/Dekk test Seal T.2` is parsed end-to-end as
part of `npm test`: 461 rows, 0 errors, both T1 and T2 channels present,
duration ≈ 69.4 minutes. Negative pressure values are preserved as raw data —
threshold logic (hold-zone detection, pass/fail) belongs to downstream modules.

See [docs/development/parser-contract.md](docs/development/parser-contract.md)
for the full input format, issue model, sorting rules, and timestamp
determinism notes.

```bash
npm test          # runs the parser tests against the canonical fixture
npm run verify    # full chain: build + test + fixture + web/prod/electron smoke
```

## Pressure analysis & hold-period

`src/domain/pressureAnalysis.ts` and `src/domain/holdPeriod.ts` extend the
parser with pure numeric reasoning: pressure-drop calculation
(`calculatePressureDrop`), time-range filtering (`selectRowsInTimeRange`), and
PASS / FAIL / UNKNOWN evaluation against a `HoldPeriodCriteria`
(`evaluateHoldPeriod`). All consume `PressureRow[]` from the parser; none of
them touch the DOM, Chart.js, jsPDF, or CSV.

`dropPct` is reported in **percent points** (a 5 % drop is `5`, not `0.05`),
and uses `Math.abs(reference)` so the sign of `dropPct` follows the sign of
`dropBar` — important for channels like T1 in the canonical fixture where all
values are negative. `HoldPeriodCriteria.maxDropPct` uses the same unit, so
`maxDropPct: 5` reads as "fail if drop exceeds 5 %".

Canonical-fixture expectations (encoded as Vitest assertions): T2 over the
full fixture drops 15.107940 bar (≈ +4.8055 percent points) in 69.4 min; T1
*increases* 0.913717 bar over the same period (≈ -30.8823 percent points,
negative because pressure went up — automatically PASS for any positive
threshold).

See [docs/development/pressure-analysis-contract.md](docs/development/pressure-analysis-contract.md).

## File upload summary

The Electron renderer now consumes the parser and pressure-analysis layers
end to end. Pick a local IHPU log (`.txt`/`.csv`/`.dat`/`.tsv`/`.log`) and the
app shows: parser summary (rows / warnings / errors / duration / channels
present), pressure-drop summary (start / end / drop / drop % of start /
optional drop % of target / bar/min / bar/hour / pressure-increased flag),
and a hold-period verdict (PASS / FAIL / UNKNOWN with used / allowed /
margin %). All values come straight from the domain layer — no re-derivation.

Default channel is `p2` (T2), default `maxDropPct` is `5` (percent points).
On the canonical fixture this yields PASS at 4.8055 % drop. Tightening the
allowed drop to `4` yields FAIL; setting target pressure to `315` switches
the reference and produces 4.7962 %.

No chart, PDF, or CSV in this slice — they are upcoming PRs and will all
consume the same `HoldPeriodResult` so dashboard, exports, and reports
cannot disagree on numbers.

See [docs/development/ui-file-upload-summary.md](docs/development/ui-file-upload-summary.md).

## Pressure chart + period selection

The app now renders a Chart.js trykkforløp with both T1 and T2 datasets, and
lets the operator pick the actual hold period from the log — either by
typing Fra/Til times (`HH:MM` or `HH:MM:SS`) or by clicking and dragging
horizontally inside the chart. Wheel/pinch zoom is supported; drag is
reserved for period selection.

For oil/gas trykktest work this is core, not polish: the whole-log drop %
is meaningless because the ramp-up and depressurisation phases dominate it.
The operator must be able to evaluate exactly the steady-state portion they
care about.

The selected range flows through to `calculatePressureDrop` and
`evaluateHoldPeriod` via their existing `fromTimestampMs` / `toTimestampMs`
options — no domain changes.

See [docs/development/pressure-chart-period-selection.md](docs/development/pressure-chart-period-selection.md).

## Report export

The Kunderapport section lets the operator fill in customer / project / location
/ test-date / IHPU-serial / ROV-system / operator / comment, then export the
result as either a CSV (machine-readable raw rows + summary) or a PDF
(human-readable customer report with PASS / FAIL / UNKNOWN badge). Both
artifacts read from the same `ReportModel` produced by `buildReportModel`,
so the dashboard, the CSV, and the PDF cannot disagree on numbers.

CSV uses CRLF line endings and period decimal separator (machine-readable).
PDF is text-only A4 with a prominent result badge — the chart image is
intentionally deferred to a follow-up PR.

See [docs/development/report-export-foundation.md](docs/development/report-export-foundation.md).

## Manual data entry

Operators can also type pressure data row by row, or paste tab-separated
tables, when a complete log file isn't available. Manual rows feed the
**same** parser/analysis/chart/report pipeline as file uploads — there is
no parallel analysis path for manual data, and the canonical parser /
domain layer remains untouched.

The "Datakilde" section at the top of the app exposes a radio toggle
between file upload and manual entry. Both inputs are kept in state, so the
operator can switch back and forth without re-uploading or re-typing.

See [docs/development/manual-entry-and-validation.md](docs/development/manual-entry-and-validation.md).

## Test session workflow

The "Test-økt" card at the top of the app autosaves the operator's working
context (source mode, channel, period, criteria, metadata, manual rows) to
`localStorage` on every change, restores it on startup, and supports
`Ny test` (full reset), `Eksporter session` (JSON download), and
`Importer session` (JSON file picker). Versioned schema, hand-rolled
validation — bad localStorage data is auto-cleared, never crashes the app.

Raw uploaded file content is **not** persisted — only the filename + parser
summary. After a restart the operator sees "Sist økt gjenopprettet — velg
<filename> på nytt for å fortsette analysen." and reselects the file. Manual
rows round-trip in full because they originated as operator input.

See [docs/development/test-session-workflow-and-persistence.md](docs/development/test-session-workflow-and-persistence.md).

## Migration roadmap

1. ~~Bootstrap structure~~ (done)
2. ~~Preview / smoke / fixture integrity harness~~ (done)
3. ~~Pure-TypeScript parser in `src/domain/ihpuParser.ts` + Vitest coverage against `test-data/Dekk test Seal T.2`~~ (done)
4. ~~Pressure analysis + hold-period evaluation~~ (done)
5. ~~File upload + summary UI~~ (done)
6. ~~Chart + period selection~~ (done)
7. ~~CSV / PDF report export foundation~~ (done)
8. ~~Manual data entry + validation~~ (done)
9. ~~Test-session workflow + project persistence~~ (done)
10. Multi-file overlay / comparison
11. Report polish + chart image in PDF
12. Windows installer + ICO + code-sign + release packaging
13. Final UI polish + operator QA checklist
