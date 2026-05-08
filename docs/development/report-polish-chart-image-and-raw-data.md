# Report polish: chart image and raw-data table in PDF

This is the report-polish PR (roadmap item 11). It extends the customer
PDF with two long-overdue customer-facing sections without changing any
of the analysis numbers, the CSV format, the parser, or the chart
internals:

- **Trykkforløp** — the chart canvas captured as a PNG and embedded after
  the PASS / FAIL / UNKNOWN badge. Carries the operator's selected-period
  highlight as drawn live in the UI.
- **Rådata** — the same row set the CSV uses, rendered as a tabular
  section after the analysis summary. Truncates gracefully on huge
  selections.

Installer/ICO/code-signing (roadmap 12) and UI polish + operator QA
checklist (roadmap 13) are out of scope for this PR.

## What ships

| Surface | Added |
|---|---|
| `src/charts/pressureChart.ts` | New methods `toBase64Image()` and `getCanvasDimensions()` |
| `src/charts/captureChart.ts` | New — pure adapter: `captureChartImage(source) → ChartImage \| null` |
| `src/reports/reportRows.ts` | New — shared row-filter (extracted from csvExport) + truncation helper |
| `src/reports/csvExport.ts` | Now imports `filterRowsToReportPeriod` from the shared module — behaviour unchanged |
| `src/reports/pdfReport.ts` | New `BuildPdfOptions` parameter (`chartImage?`, `rows?`); new Trykkforløp + Rådata sections |
| `src/app/events.ts` | `handleExportPdf` now captures chart + passes raw rows |
| `tests/pdfReport.test.ts` | +13 tests (chart on/off, raw-data on/off, truncation boundaries, mixed) |
| `tests/captureChart.test.ts` | New — 8 tests using a structural fake source |
| `tests/smoke/electron.spec.ts` | File flow asserts PDF byte size > 30 kB after export |

## Chart capture

`PressureChart` exposes two new methods. Both return `null` when the
chart isn't mounted with data — same idiom as `isReady()`:

```ts
toBase64Image(): string | null              // 'data:image/png;base64,...'
getCanvasDimensions(): { widthPx; heightPx } | null
```

The methods are thin wrappers around Chart.js's native
`chart.toBase64Image('image/png', 1.0)` and the canvas's intrinsic
`canvas.width / canvas.height`. **No `html2canvas` dependency.**

`captureChartImage(source)` in `src/charts/captureChart.ts` takes a
**structural** `ChartImageSource` (not `PressureChart` directly), so the
unit tests don't have to mount Chart.js inside jsdom — Chart.js needs a
real canvas 2D context which jsdom only partially implements. The real
`PressureChart` satisfies the interface by virtue of having those
methods.

## PDF API

`buildCustomerReportPdf` now takes an optional second parameter:

```ts
interface BuildPdfOptions {
  chartImage?: { dataUrl, widthPx, heightPx };
  rows?: PressureRow[];
}
```

Both fields are independently optional. When omitted, the corresponding
section is skipped — so a chartless PDF works the same as before, and
older callers don't need changes. `handleExportPdf` now:

1. Calls `ctx.chart.isReady() ? captureChartImage(ctx.chart) : null`
2. Passes `chartImage` and `rows: state.parseResult?.rows` into the builder
3. If the chart capture fails (returns null), the PDF is still emitted
   without the Trykkforløp section

The builder itself stays pure — no DOM, no Chart.js, no canvas access,
no renderer state.

## Layout

```
Title
Project metadata
Selected period
Criteria
[ PASS / FAIL / UNKNOWN badge ]
Trykkforløp                 ← optional, chart image full content-width, max 90mm
Holdperiode-detaljer
Trykkfallanalyse
Rådata (N rader for valgt periode)   ← optional, tabular, paginated
Parser-sammendrag
Meldinger (if any)
Kommentar (if any)
Footer
```

Chart image:
- Full content-width (~174 mm on A4)
- Aspect ratio computed from `heightPx / widthPx`, capped at 90 mm
- Italic caption: "Markert område viser valgt analyse-periode (når satt)"

Raw-data table:
- Columns: `# / localIso / tMinutes / p1 / p2`
- Header row repeated on every page break
- Same row-filter as CSV (via `filterRowsToReportPeriod` in `reportRows.ts`)
- Truncation rule:
  - **≤ 1000 rows** — all rows verbatim
  - **> 1000 rows** — first 500 + `… N rader utelatt …` marker + last 500
- Empty selected period → `Ingen rader i valgt periode.`

## Truncation rule rationale

The fixture has 461 rows, so the threshold of 1000 keeps the canonical
PDF output complete. A 5–10 minute trykktest log can run several
thousand rows; embedding them all turns the PDF into 60+ pages of
tabular noise, which is hostile to the customer experience. The
first-500 + last-500 split preserves the most operator-relevant rows
(start of hold + end of hold) while keeping the PDF page count
reasonable.

The threshold and half-size are exported from `reportRows.ts`
(`RAW_DATA_TRUNCATION_THRESHOLD = 1000`,
`RAW_DATA_TRUNCATION_HALF = 500`) so a future PR can tune them
without re-finding the constants.

## Why no html2canvas?

Chart.js already provides a native PNG export through its public API
(`chart.toBase64Image(...)`). It uses the same canvas the chart was
drawn on, so the highlight overlay, axes, legend, fonts, and selected-
period rectangle are all captured exactly as the operator sees them —
no extra DOM round-trip, no font re-rendering quirks. Adding a third
rendering library (html2canvas) only to do something Chart.js already
does would be a net loss.

## Tests

| File | Tests | Covers |
|---|---|---|
| `tests/captureChart.test.ts` | 8 | structural fake; null/empty/zero-dim guards; happy path; defensive throw |
| `tests/pdfReport.test.ts` | 20 | existing 7 + chart-on/off (5) + raw-data on/off + boundaries (8) |

Boundaries deliberately covered:

- 0 rows → "Ingen rader i valgt periode"
- 461 rows (canonical fixture) → no truncation marker
- 1000 rows → no truncation (boundary)
- 1001 rows → truncation marker shows "1 rader utelatt"
- 1500 rows → truncation marker shows "500 rader utelatt"

## Smoke

`tests/smoke/electron.spec.ts` file flow now asserts the PDF byte size
is > 30 kB after export. With chart + 461-row Rådata, real exports
land around 100 kB. The threshold is conservative — a baseline
text-only PDF for the same fixture is ~5–10 kB, so the assertion
catches a regression where the chart or raw-data section silently
drops out.

The other three flows (manual / overlay / session) already exercised
PDF export; they keep working unchanged.

## Strict non-goals

- ❌ Installer / NSIS work (roadmap 12)
- ❌ ICO / app icon (roadmap 12)
- ❌ Code signing (roadmap 12)
- ❌ Chart-overlay / multiple datasets in the chart
- ❌ Overlay data in PDF
- ❌ Overlay persistence in TestSession
- ❌ New dependencies — no `html2canvas`, no chart.js plugin additions
- ❌ Changes to `package.json`, `package-lock.json`, fixture, legacy HTML, electron main process

## Files NOT touched

- `src/domain/*` — entirely untouched
- `src/manual/*` — entirely untouched
- `src/session/*` — entirely untouched
- `src/utils/*` — entirely untouched
- `electron/*` — entirely untouched
- `package.json` / `package-lock.json` — entirely untouched
- `test-data/Dekk test Seal T.2` — fixture sha256 unchanged
- `legacy/IHPU_TrykkAnalyse.original.html` — unchanged

## Verification

```
npm run build          PASS
npm test               PASS — 211 unit tests, 0 skipped (21 new)
npm run smoke:fixture  PASS
npm run smoke:web      PASS
npm run smoke:prod     PASS
npm run smoke:electron PASS — file / manual / overlay / session
npm run verify         PASS
```
