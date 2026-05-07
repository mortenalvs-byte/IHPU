# Report export foundation

This is the report/export PR. It turns the analyser into a customer
documentation tool — operator picks the file and the period, fills in
project metadata, and clicks one button to get a CSV (machine-readable raw
data + summary) or a PDF (human-readable customer report).

There is no PDF/CSV "polish PR" before this. The point of v1 is that the
report numbers exist on disk in a form the customer can keep, and that
those numbers come from the **same** computed objects the dashboard shows.

## Data flow

```
                 ┌──────────────────────────────────────────────┐
                 │ AppState (already populated by upload + chart)│
                 │   parseResult                                 │
                 │   baselineDrop / targetDrop / holdResult      │
                 │   selectedFromTimestampMs / toTimestampMs     │
                 │   reportMetadata (operator-filled)            │
                 │   exportStatus                                │
                 └─────────────────┬────────────────────────────┘
                                   │
                                   ▼
                       buildReportModel(input)        (src/reports/reportModel.ts)
                                   │
                                   ▼
                              ReportModel
                       ─ pure data, no recomputation ─
                                   │
                ┌──────────────────┴───────────────────┐
                ▼                                      ▼
     buildReportCsv(model, rows)            buildCustomerReportPdf(model)
     (src/reports/csvExport.ts)             (src/reports/pdfReport.ts)
                │                                      │
                ▼                                      ▼
        triggerCsvDownload                   triggerPdfDownload
        (renderer-only)                       (renderer-only)
                │                                      │
                ▼                                      ▼
        Blob + a.click()                      Blob + a.click()
```

`buildReportModel` is the single point where AppState becomes a report. CSV
and PDF read from the resulting `ReportModel`. They never look at AppState
themselves and never call `calculatePressureDrop` again. This is what
guarantees the numbers in the dashboard, the CSV, and the PDF can never
disagree.

## Module boundaries

| Module | Pure? | Owns |
|---|---|---|
| `src/reports/reportTypes.ts` | yes | `ReportModel`, `ReportMetadata`, `ReportBuildResult` discriminated union |
| `src/reports/reportModel.ts` | yes | `buildReportModel(input) → ReportBuildResult`. No DOM, no fetch, no IO. |
| `src/reports/csvExport.ts` | mixed | `buildReportCsv(model, rows)` + `buildSafeReportFilename` are pure. `triggerCsvDownload` uses `document` and is renderer-only. |
| `src/reports/pdfReport.ts` | mixed | `buildCustomerReportPdf(model)` returns `ArrayBuffer` (pure, jsPDF only). `triggerPdfDownload` uses `document`. |
| `src/app/state.ts` | yes | Adds `reportMetadata` and `exportStatus` to `AppState`. |
| `src/app/render.ts` | DOM | Renders the Kunderapport section, syncs metadata inputs, toggles export-button enabled state, surfaces export-status. |
| `src/app/events.ts` | DOM | Wires metadata `input` events, click handlers for `export-csv-button` and `export-pdf-button`, calls the pure builders + DOM-only `triggerXDownload`. |

`src/charts/`, `src/domain/`, `src/utils/` are not touched in this PR.

## ReportModel contract

`ReportModel` is a frozen-shape data object with these top-level fields:

- `generatedAtIso` — ISO-8601 UTC string captured at build time
- `sourceFileName` — original `File.name` of the loaded log
- `parser` — parsed-row count, warnings, errors, first/last timestamp, log-duration
- `selectedPeriod` — operator's analysis range: `fromIso`/`toIso`/`fromText`/`toText`/`durationMinutes`/`isFullRange`
- `analysis` — channel, start/end pressure, dropBar, dropPctOfStart, dropPctOfTarget, bar/min, bar/hour, pressureIncreased
- `criteria` — maxDropPct, targetPressure, referencePressure used for hold evaluation
- `hold` — status PASS/FAIL/UNKNOWN, used/allowed/margin (all in **percent points**), warnings/errors as compact strings
- `metadata` — customer, project, location, testDate, IHPU serial, ROV system, operator, comment

`buildReportModel` returns a discriminated union (`{ ok: true; report } | { ok: false; error }`). Errors:

- `NO_FILE` — no parseResult
- `NO_ROWS` — parseResult had zero rows
- `NO_ANALYSIS` — `baselineDrop` is null
- `NO_HOLD` — `holdResult` is null

Never throws.

## CSV format

```
# IHPU TrykkAnalyse — kunderapport (CSV)
Felt,Verdi
Generert,2026-05-08T01:30:11.123Z
Kilde-fil,Dekk test Seal T.2
Kunde,Test Customer AS
Prosjekt,PRJ-001
…

# Parser-sammendrag
Felt,Verdi
parsedRows,461
warnings,0
errors,0
firstTimestamp,2026-02-21T13:10:37
lastTimestamp,2026-02-21T14:20:01
durationMinutes,69.4

# Valgt periode
…

# Analyse
Felt,Verdi
channel,p2
startPressure_bar,314.386993
endPressure_bar,299.279053
dropBar,15.10794
dropPctOfStart,4.8055232361
…

# Holdperiode-resultat
Felt,Verdi
status,PASS
usedDropPct,4.8055232361
allowedDropPct,5
marginPct,0.1944767639

# Rader (461 av 461 parsede rader for valgt periode)
index,sourceLine,localIso,tMinutes,p1,p2
0,1,2026-02-21T13:10:37,0,-2.958707,314.386993
1,2,2026-02-21T13:10:44,…
```

Rules:

- **CRLF** line endings (Windows-friendly, Excel-friendly).
- **Period decimal** separator. No Norwegian comma, no thousands separators —
  these are machine-readable numeric values. Customers who want a localised
  view should open the PDF.
- **Quote escaping** wraps any cell containing `,`, `"`, `\r`, or `\n` in
  double quotes and doubles internal quotes.
- **Numeric precision** preserves jsRuntime accuracy (`String(value)`); the
  display rounding only happens in the UI and PDF.

## PDF format

A4, simple flow layout. Sections in order:

1. Title + generation timestamp + source file
2. Project metadata block (customer/project/location/test date/serial/ROV/operator)
3. Selected period block (range, duration, channel)
4. Criteria block (maxDropPct, targetPressure, referencePressure)
5. **Result badge** — full-width PASS / FAIL / UNKNOWN bar in green/red/grey
6. Hold detail block (used/allowed/margin)
7. Trykkfallanalyse block (start/end/drop/dropPct/rate/pressureIncreased)
8. Parser-sammendrag block (rows/errors/warnings/timestamps)
9. Issues / warnings (only if any)
10. Operator comment (only if non-empty)
11. Footer with generation timestamp

The PDF is **text only**: no chart image, no embedded fonts beyond jsPDF's
defaults, no network resources. Adding the chart screenshot is intentionally
deferred — capturing a Chart.js canvas reliably across Electron windows is a
separate problem and a separate PR.

The PDF is also intentionally **deterministic in structure** but not
byte-for-byte: jsPDF embeds a non-deterministic ID. Tests assert PDF magic
bytes (`%PDF-`), trailing `%%EOF`, and that the builder doesn't throw across
PASS/FAIL/UNKNOWN status and missing-metadata scenarios.

## Filename strategy

`buildSafeReportFilename(report, ext)`:

- If `metadata.projectNumber` and `metadata.testDate` are non-empty:
  `IHPU_<project>_<date>_<status>.csv|pdf` (e.g. `IHPU_PRJ-001_21.02.2026_PASS.csv`)
- Otherwise: `IHPU_report_YYYYMMDD-HHMMSS.csv|pdf` from the generation
  timestamp.

Filesystem-unsafe characters (`< > : " / \ | ? *`, control chars, whitespace
runs) are sanitised before being placed in the filename.

## UI behaviour

- Export buttons are **disabled** until a file is parsed AND analysis succeeded.
- Clicking either button:
  1. Calls `buildReportModel` from current state.
  2. On success: builds the bytes via the pure helper, calls
     `triggerXDownload`, sets `state.exportStatus = { kind: 'success', ... }`.
  3. On failure (build error or thrown helper): sets `state.exportStatus =
     { kind: 'error', ... }` with a Norwegian message.
- `export-status` text echoes the filename and byte size for easy traceability.
- The Kunderapport section also shows a live preview: result status, channel,
  selected period, drop summary — so the operator can confirm what's about to
  be exported without reading the PDF first.

## Smoke coverage

`tests/smoke/electron.spec.ts`:

1. App starts; export buttons disabled.
2. Upload canonical fixture; assert dashboard updates (existing chart/period
   coverage retained).
3. Confirm `report-preview-status = "Klar for eksport"`, `report-result-status
   = "PASS"`, `report-channel = "P2"`, `report-drop-summary` contains 15.108.
4. Manual period round-trip (still works after PR #5).
5. Fill metadata fields, assert export buttons become enabled.
6. Click CSV export, assert `export-status` contains `CSV exported`,
   `PRJ-001`, `PASS`, `.csv`.
7. Click PDF export, assert `export-status` contains `PDF exported`, `.pdf`.
8. Save screenshot.

Per the foundation contract, the smoke deliberately verifies the **status
string** and that the click does not crash. Deep CSV/PDF content (CRLF,
quote escaping, jsPDF magic bytes, status mapping, filename sanitisation)
is covered by Vitest unit tests against pure builders. Capturing the actual
downloaded files via Playwright Electron is fragile across runners, so we
don't attempt it.

## Why no chart image yet

Embedding a Chart.js canvas snapshot in the PDF requires either calling
`canvas.toDataURL()` from the renderer at PDF-build time (which couples the
report to the live chart instance) or pre-rendering the chart server-side
(which we don't have). Both are real options for a follow-up PR; neither is
cheap to make robust and tested. v1 ships text-only — the customer gets
authoritative numbers and an audit trail. Visualisation is a follow-up.

## Known limitations

- No chart image in PDF (see above).
- The PDF uses jsPDF's built-in Helvetica. Norwegian characters (æ, ø, å,
  apostrophes) render in Latin-1 and will look fine in any reasonable PDF
  reader. Custom fonts can be added later.
- CSV row section emits all rows in the selected period. Very large logs
  (50k+ rows) may produce CSV files in the multi-megabyte range. That's
  acceptable for v1; future polish could offer a sub-sample option.
- `triggerPdfDownload` / `triggerCsvDownload` use Blob + anchor click. On
  Electron without a custom `will-download` handler, the OS Save As dialog
  appears. The renderer is not blocked — `export-status` updates immediately.
  This is fine for v1; if it becomes annoying, a follow-up can wire a
  preload-bridge save handler.
- No multi-test report (one log per report). Multi-file overlay is its own
  PR.

## Out of scope

- Manual data entry (separate PR)
- Multi-file overlay
- Installer / ICO / signing
- Domain changes
- Auto-detect hold period
- Server-side rendering / cloud upload
- Localisation beyond Norwegian
- Custom PDF templates per customer

## Next phases

- `manual-entry-and-validation` — operator can input known pressure points
  by hand when the log file is unavailable, with explicit validation.
- `multi-file-support-and-comparison` — compare multiple logs side by side.
- `packaging-installer-icon-release` — NSIS installer, app icon, code-sign
  story.
