# Manual data entry and validation

This is the manual-input PR. It lets the operator type pressure-test data
into the app — by single rows or by pasting tab-separated tables — and feed
the result through the **same** parser/analysis/chart/report pipeline that
file-uploaded data uses. There is intentionally **no** parallel analysis path
for manual data.

## Why manual entry exists

In oil/gas trykktest practice, source data can come from:

- automated logs
- handwritten control measurements
- spot checks during pump-down or hold
- corrected values after a sensor anomaly
- partial logs that need to be supplemented

If the app only worked when a perfect log file existed, half of real
operator workflows would be impossible. Manual entry closes that gap
without weakening the canonical-fixture contract.

## Architecture: one analysis path, two inputs

```
file upload                 manual rows
     │                            │
     ▼                            ▼
parseIhpuPressureLog()    buildManualParseResult()
   (src/domain/)              (src/manual/)
     │                            │
     └─────────────┬──────────────┘
                   ▼
              ParseResult
                   │
                   ▼
       calculatePressureDrop / evaluateHoldPeriod
       (unchanged — src/domain/)
                   │
                   ▼
           chart / CSV / PDF
```

`buildManualParseResult` produces the **exact** `ParseResult` shape the
parser produces, including `meta.channelStats`, `meta.channelsPresent`, the
deterministic `Date.UTC`-based `timestampMs`, sort order, `tMinutes`, and
`raw` strings. Downstream code can't tell whether it's looking at a file
parse or a manual conversion — and that's the point.

The active source is tracked in `AppState.sourceMode: 'file' | 'manual'`.
`fileParseResult` and `manualRows` are kept independently so the operator
can switch back and forth without re-uploading or re-typing.

## Modules

| Module | Pure? | Owns |
|---|---|---|
| `src/manual/manualTypes.ts` | yes | `ManualRow`, `ManualValidationResult`, `ManualPasteOutcome`, `DataSourceMode`. Includes a tiny stable id generator for table keys. |
| `src/manual/manualValidation.ts` | yes | `validateManualRows(rows) → ManualValidationResult` and `parseManualPaste(text) → ManualPasteOutcome`. Reuses `parseDateParts` / `parseTimeParts` from `src/utils/dateTime.ts` so manual validation and file parsing accept the same date/time formats bit-for-bit. |
| `src/manual/manualRows.ts` | yes | `buildManualParseResult(rows, sourceName?) → ParseResult`. Mini-builder that mirrors the parser's structure (sort, tMinutes, channel stats, issue codes). No DOM. |
| `src/app/state.ts` | yes | Adds `sourceMode`, `fileParseResult`, `manualRows`, `manualValidation` to `AppState`. |
| `src/app/render.ts` | DOM | New "Datakilde" card containing the source-mode radios, the upload UI (existing), and the manual-entry UI. Manual table body is rebuilt via `document.createElement` — no `innerHTML` for user-typed cell values. |
| `src/app/events.ts` | DOM | Wires every manual button + the source-mode radios. Routes everything through `applyActiveSource(ctx)` so file→manual→file transitions go through one code path. |

## Accepted formats

- **Date** — `DD.MM.YYYY` or `YYYY-MM-DD` (same as the file parser).
- **Time** — `HH:MM` or `HH:MM:SS`.
- **Pressure** — number with `.` or `,` decimal. Negative values accepted.
- **Empty channel** — exactly one of T1 / T2 may be empty (the row is still
  valid). Both empty fails with `NO_CHANNELS`.

Paste accepts:

- `DD.MM.YYYY HH:MM:SS<TAB>T1<TAB>T2`  (3 tab-separated fields)
- `DD.MM.YYYY<TAB>HH:MM:SS<TAB>T1<TAB>T2`  (4 tab-separated fields)
- whitespace fallback when no tabs are present (`<DATE> <TIME> <T1> <T2>`)

Blank lines are skipped. Malformed lines are reported as issues but do not
abort the rest of the paste.

## Validation rules

Per row:

- **EMPTY_ROW** (error) — every field is blank
- **INVALID_DATE** (error)
- **INVALID_TIME** (error)
- **INVALID_NUMBER** (error, `field: 'p1' | 'p2'`) — non-empty cell that doesn't parse as a number
- **NO_CHANNELS** (error) — both T1 and T2 cells are empty (after the row is otherwise non-blank)

Cross-row:

- **DUPLICATE_TIMESTAMP** (warning) — two rows resolve to the same `Date.UTC` ms key
- **UNSORTED** (warning) — collection isn't ascending by time. Build still sorts the output.
- **NO_VALID_ROWS** (error) — at least one row is present but none passed per-row validation

`ManualValidationResult` carries `errors`, `warnings`, and a merged `issues`
list. The UI surfaces a one-line summary in `manual-validation-errors`,
prefixing the first concrete issue so the operator knows where to look.

## Negative pressure values

Preserved unchanged. T1 in the canonical fixture is all-negative, and the
parser/analysis layers already handle this end-to-end. Manual entry follows
the same rule: never reject a row because a value is negative. Threshold
logic (e.g. "T2 must be > 10 bar to count as a hold zone") still belongs to
analysis or higher layers.

## UI behaviour

- The source-mode radios at the top of the **Datakilde** card switch which
  input feeds the rest of the app.
- The manual-entry card is always visible — the operator doesn't have to
  switch modes first to type rows. They can prepare manual data while a
  file is loaded, then click "Bruk manuelle rader" to swap.
- "Legg til rad" appends a row, validates, and clears the four input fields
  so the next row can be typed immediately.
- "Importer fra paste" appends every successfully-split paste line to the
  collection and re-validates.
- "Slett" on a row removes it. If manual is the active source, the analysis
  and chart re-run on the new collection automatically.
- "Tøm manuelle rader" empties the collection. If manual is active, the
  pipeline goes back to "Ingen data lastet".
- "Bruk manuelle rader" forces `sourceMode = 'manual'` and re-runs the
  pipeline with the current rows.

## When manual is the active source

- `state.parseResult` is built from `state.manualRows` via
  `buildManualParseResult`. Same shape as file parsing.
- `state.selectedFileName` is set to `'Manual entry'`. The Kunderapport
  section, CSV export, and PDF export pick this up automatically — no
  CSV/PDF code changes were needed.
- The chart instance is re-mounted with the manual rows.
- Pressure analysis, hold-period evaluation, and the operator-selected
  period selection all work unchanged.

## Smoke coverage

`tests/smoke/electron.spec.ts` now contains two tests:

1. **file flow** — original upload → period → metadata → CSV/PDF export
2. **manual flow** — type three rows → "Bruk manuelle rader" → assert
   parsed-row-count = 3, drop bar = 30.000, chart ready, both channels
   present, hold status renders. Then fill metadata, export CSV, export
   PDF. Then delete one row (count → 2), then clear all (count → 0,
   parsed-row-count → "—").

The smoke deliberately does NOT exercise paste (the textarea is harder to
fill reliably across runners). Paste is unit-tested instead.

## Unit test coverage

| File | Tests | Covers |
|---|---|---|
| `tests/manualValidation.test.ts` | 20 | per-row validation (date/time/number/empty/single-channel/decimal-comma/negative) + cross-row (duplicate, unsorted, no-valid-rows) + paste (formats, blank lines, malformed lines, negative values) |
| `tests/manualRows.test.ts` | 11 | `ParseResult` shape, deterministic `Date.UTC` timestamps, tMinutes, sort + UNSORTED warning, negative preservation, hand-off to `calculatePressureDrop` and `evaluateHoldPeriod`, error paths, no input mutation, custom sourceName, `channelsPresent` correctness |

## Out of scope

- Editing rows in place. v1 is add / delete / clear. Edit-in-place would
  need either inline form fields per row or a modal dialog — separate UX
  work, not blocking the integration.
- Persisting the manual collection across app launches. PR #8
  (`test-session-workflow-and-project-persistence`) handles save/restore.
- Multi-day logs in manual entry. The first row's date is used as the
  canonical day reference everywhere; multi-day support is part of
  `multi-file-support-and-comparison`.
- Auto-importing "messy" pastes (Excel-copied with locale-specific
  separators, smart quotes, etc.). v1 accepts tab-separated and
  whitespace-separated. Smarter parsing can come later if customers
  actually paste in those forms.

## Manual QA checklist before release

The smoke covers the happy path on canonical/synthetic data. Before
shipping a release with manual entry, run through this checklist on a real
Windows desktop:

1. Open `Start IHPU.bat`.
2. Pick "Manuell registrering" radio.
3. Type a date, time, T1, T2 and click "Legg til rad". Confirm the row
   appears in the table and the four inputs clear.
4. Type a row with a bad date (`32.13.2026`) and click "Legg til rad".
   Confirm the row is added but the validation summary calls it out.
5. Paste a small block of tab-separated rows (3–5 lines). Confirm count,
   table contents, and validation summary update.
6. Click "Bruk manuelle rader". Confirm chart, pressure summary, hold
   status, and Kunderapport preview all populate.
7. Export CSV and PDF; confirm the download dialog appears and the file
   names use `IHPU_<project>_<date>_<status>.<ext>`.
8. Delete one row, confirm pipeline updates.
9. Clear all rows, confirm pipeline goes back to empty.
10. Switch back to "Fil-opplasting", upload `test-data/Dekk test Seal T.2`.
    Confirm the file pipeline reactivates without losing the manual rows
    in state.
11. Switch back to "Manuell registrering", confirm the previously-typed
    rows are still present.

If any of these fail, file a bug; do not merge.

## Why no `localStorage` in this PR

Manual rows live in memory only. Persistence is a separate concern with its
own UX (autosave conflicts, dirty-state warnings, restore prompts) and is
the focus of PR #8. Mixing it in here would bloat scope and risk
half-implementing both.
