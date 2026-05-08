# Multi-file comparison foundation

This is the first overlay PR. It introduces a side-by-side comparison
table for additional uploaded trykktest logs, on top of (and never
replacing) the existing single-file analysis. Chart-overlay, session-JSON
persistence of comparison entries, and report-export integration are
explicitly **out of scope** for this PR — they will land in follow-ups
that build on this foundation.

## Goal

Let an operator run one trykktest analysis as the primary working
context, then load any number of additional logs to compare them
side-by-side against the same `maxDropPct` / `targetPressure` criteria.
The point is to spot quickly which test is best/worst without leaving
the app or re-running the primary analysis.

## What ships in this PR

| Surface | Added |
|---|---|
| `src/domain/overlay.ts` | Pure domain module (no DOM/Chart/jsPDF/PapaParse/localStorage) |
| `src/app/state.ts` | Additive `overlay: OverlayState` slice on `AppState` |
| `src/app/events.ts` | `handleOverlayFilesSelected`, `handleOverlayRemove`, `handleOverlayClear`, all routed through `commit(ctx)` |
| `src/app/render.ts` | New "Sammenlign tester" card + `renderOverlaySection` |
| `src/styles/app.css` | Card / table styling + best/worst markers |
| `tests/overlay.test.ts` | 27 unit tests against the canonical fixture |
| `tests/smoke/electron.spec.ts` | 4th Electron smoke: overlay flow |

## Pure domain module

`src/domain/overlay.ts` exposes:

```ts
buildOverlayEntry(options): OverlayBuildResult
computeOverlayComparison(entries, criteria): OverlayComparison
generateOverlayEntryId(filename, addedAtMs): OverlayEntryId
```

`buildOverlayEntry`:

- runs `parseIhpuPressureLog` on the supplied `fileText`
- runs `calculatePressureDrop` and `evaluateHoldPeriod` for **both** T1
  and T2 against the supplied criteria
- returns a discriminated union — never throws on a normal parse
  failure. Failure reasons:
  - `EMPTY_TEXT` — no input at all (or non-string)
  - `NO_VALID_ROWS` — parser returned zero rows but no errors
  - `PARSE_FAILED` — parser returned errors

`computeOverlayComparison`:

- takes a snapshot of `entries` (does **not** mutate the input array
  or any of its members)
- re-runs `calculatePressureDrop` and `evaluateHoldPeriod` per entry
  against the **current** criteria, so the table reflects the operator's
  live `maxDropPct` / `targetPressure` rather than whatever was active
  when the file was first uploaded
- preserves entry order
- identifies the lowest and highest finite T2 dropPct as best/worst
  markers; with only one comparable entry, marks only "best"
- returns `incomparableCount` for entries whose T2 channel is missing
  or non-finite

The domain layer is fully covered against the canonical fixture
(`test-data/Dekk test Seal T.2`):

- 461 rows / 0 errors / both channels present
- T2 drop ≈ 15.108 bar (~4.8055 % of start)
- T1 *increases* ~0.91 bar → negative dropPct → automatic PASS for any
  positive threshold
- maxDropPct=4 → T2 verdict flips to FAIL
- targetPressure=315 → T2 dropPct shifts to ~4.7962 %

These match the existing pressure-analysis-contract numbers verbatim.

## Additive state

```ts
state.overlay = {
  entries: OverlayEntry[],
  addStatus: { kind: 'idle' | 'success' | 'warning' | 'error', message: string }
}
```

`activeSource`, `parseResult`, `baselineDrop`, `targetDrop`,
`holdResult`, and the chart are **not** touched by overlay code. The
overlay slice is read by `renderOverlaySection` only. Removing or
clearing overlay entries cannot affect primary analysis — verified by
the smoke test.

## Event flow

```
file picker (overlay-file-input, multiple)
  → handleOverlayFilesSelected
    → for each File: buildOverlayEntry({ filename, fileText, criteria })
    → push successful entries onto state.overlay.entries
    → record success/warning/error addStatus
    → commit(ctx)
      → autosave + render
```

`commit(ctx)` is reused verbatim — overlay handlers do not duplicate
any commit / render / autosave logic. (The user spec allowed pulling
overlay handlers into a separate file if the split is clean. They
remain in `events.ts` for this PR because that avoids exporting
`commit` / `autosave` / `render` purely for the overlay's benefit.)

## UI

A new "Sammenlign tester" card appears between the report card and
the manual section, visible from startup with an empty state.

- Separate `<input type="file" multiple data-testid="overlay-file-input">`
  — never shares the primary file input
- "Tøm sammenligning" button
- Status line + summary line (count, best T2 drop %, worst T2 drop %,
  incomparable count)
- Comparison table columns:

  | Filename | Rows | Duration | T2 start | T2 end | T2 drop bar | T2 drop % | T2 verdict | T1 verdict | Added | Remove |

- Best/worst T2 drop % cells get `overlay-best` / `overlay-worst`
  classes plus `data-testid` markers (`overlay-best-cell`,
  `overlay-worst-cell`)

## Smoke coverage

`tests/smoke/electron.spec.ts` adds a 4th flow:

1. `Ny test` to wipe persisted state from a prior run
2. Verify overlay card visible with empty state
3. Upload canonical fixture as primary source → assert `461` rows and
   `15.108` T2 drop and PASS verdict
4. Upload same fixture as overlay → assert table has 1 row with the
   same numbers and PASS verdict, primary still unchanged
5. Upload again → assert 2 overlay rows
6. Remove first overlay row → assert 1 row remains, primary unchanged
7. Click `Tøm sammenligning` → assert 0 rows, primary unchanged

The smoke test deliberately re-uses the same fixture twice so the
"primary unchanged after overlay add" assertion is meaningful — if
overlay handling accidentally leaked into the primary pipeline, the
primary numbers would change.

## Strict non-goals

- Chart-overlay (multiple datasets on the same canvas) — separate PR
- Persisting overlay entries in `TestSession` JSON
- Including overlay data in CSV / PDF report export
- Per-test ulike kriterier (each entry uses the operator's current
  criteria; if you want different thresholds, change them in the main
  controls)
- Time-axis sync between overlay entries
- Aborting an upload mid-stream
- Sorting the comparison table

## Files NOT touched

- `src/domain/ihpuParser.ts`
- `src/domain/pressureAnalysis.ts`
- `src/domain/holdPeriod.ts`
- `src/domain/types.ts`
- `src/charts/*`
- `src/reports/*`
- `src/utils/*`
- `src/manual/*`
- `src/session/*`
- `electron/*`
- `package.json` / `package-lock.json`
- `test-data/Dekk test Seal T.2` (sha256 + size unchanged)
- `legacy/IHPU_TrykkAnalyse.original.html`

## Verification

```
npm run build          PASS
npm test               PASS — 190 real tests, 0 skipped (27 new in tests/overlay.test.ts)
npm run smoke:fixture  PASS
npm run smoke:web      PASS
npm run smoke:prod     PASS
npm run smoke:electron PASS — file / manual / overlay / session
npm run verify         PASS
```

## Acceptance criteria

- [x] `OverlayEntry` and `OverlayComparison` are built through pure
      domain functions (`src/domain/overlay.ts`)
- [x] Overlay supports multiple uploaded files in one operator action
      (`<input type="file" multiple>`)
- [x] Primary single-file workflow remains unchanged and smoke-proven
- [x] Overlay remove/clear does not affect primary analysis
- [x] `npm run verify` PASS
- [x] Fixture sha256 unchanged
      (`8e44d28b0a295b9dbb8fecb202c8e899f8f3b6291a886128b9b22f6e6b12ca22`)
- [x] `package.json` unchanged
- [x] Legacy HTML unchanged
