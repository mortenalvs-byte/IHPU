# Pressure chart + period selection

This is the chart-PR. It also introduces operator-selectable analysis range,
because for oil/gas trykktest work, *being able to pick the actual hold period
inside the chart* is core functionality, not a polish step.

## Why period selection is core, not polish

A trykktest log typically contains:

- Pre-test ramp-up (pressure climbing to test pressure)
- The actual hold period the operator wants to evaluate
- Post-test depressurisation
- Possibly stitched-together segments from multiple sub-tests

Calculating drop / drop % / PASS-FAIL on the **whole log** is meaningless. The
ramp-up and depressurisation dominate the number. The operator needs to look
at the curve, identify the steady-state hold portion visually, and ask "did
*that* portion drop more than allowed".

Our PR #3 already taught the domain layer how to take `fromTimestampMs` /
`toTimestampMs`. This PR finally lets the operator hand them in from the UI.

## Data flow

```
file uploaded
    │
    ▼
parseIhpuPressureLog(text)            (domain)
    │
    ▼
PressureChart.setData(rows)           (renderer/UI layer)
    │
    │ ─── operator drags in chart, OR types Fra/Til, OR clicks reset
    ▼
chart callback / period inputs
    │
    ▼
AppState.selectedFromTimestampMs / selectedToTimestampMs updated
    │
    ▼
recomputeAnalysis(ctx)
  ├ calculatePressureDrop(rows, channel, {targetPressure})  ← baseline (always)
  ├ calculatePressureDrop(rows, channel, {targetPressure})  ← target (when set)
  └ evaluateHoldPeriod(rows, channel, {fromMs, toMs, targetPressure, maxDropPct})
    │
    ▼
render(root, state)
    │ ─── pushes textContent + hold-status class
    │ ─── calls chart.setSelectedRange to draw the green overlay
    ▼
DOM
```

The chart module never owns AppState and never re-derives analysis numbers.
Its only output is the drag-select callback and (separately) the visual
highlight of the currently-selected range.

## Module responsibilities

| Module | Owns | Does not |
|---|---|---|
| `src/charts/pressureChart.ts` | Chart.js instance, drag-select gesture, visual selection overlay | Compute analysis, store app state, parse files |
| `src/app/state.ts` | `AppState` shape (now extended with `selectedFrom/ToTimestampMs`, `selectedFrom/ToTimeText`, `chartReady`, `chartError`) | Reach into the DOM |
| `src/app/events.ts` | Wire DOM inputs and chart callback into state mutations + `render()` | Render |
| `src/app/render.ts` | Push state into DOM via `textContent`; sync chart selection via `chart.setSelectedRange` | Mutate state |
| `src/main.ts` | Boot order: shell → chart instance → context → wire events → first render | Anything else |

## Chart features

- Both T1 and T2 datasets render when present. The default analysis channel is
  still `p2`; selecting `p1` in the channel dropdown updates the analysis but
  both lines stay drawn so the operator can see them.
- Time axis (`type: 'time'`) using `chartjs-adapter-date-fns`. Ticks adapt to
  the visible zoom level.
- Wheel zoom + pinch zoom on the x-axis (`chartjs-plugin-zoom`). Pan is
  disabled — combined with our drag-select it would conflict.
- Drag zoom is disabled. Click-and-drag horizontally is **always** a period
  selection.
- "Tilbakestill zoom" button restores the chart's natural extent.
- "Tilbakestill periode" button clears the selection (range = full data
  range), clears the manual Fra/Til inputs, and redraws the chart.

## Period selection mechanics

### Drag in the chart

`PressureChart` listens to `mousedown` and `mousemove` on its canvas, plus
`mouseup` on `window` (so a drag that ends outside the canvas still
resolves). On mousedown the start pixel is recorded; on mousemove the chart
re-renders with a translucent blue preview rectangle; on mouseup the start
and end pixels are converted to timestamps via `chart.scales.x.getValueForPixel`,
normalised so `fromMs <= toMs`, and emitted via the `onPeriodSelected`
callback. Drags shorter than 5 pixels are treated as accidental clicks and
ignored.

### Manual Fra / Til inputs

The operator can type `HH:MM` or `HH:MM:SS`. The text passes through
`parseTimeParts` from `src/utils/dateTime.ts`. The date is read from
`rows[0].localIso` so the result is a deterministic `Date.UTC`-based ms key
on the same day as the log. Invalid inputs surface via `chartError` in the
issues panel; they do not crash and they do not silently overwrite the active
range.

This works for single-day logs (the canonical fixture pattern). For
multi-day logs the first occurrence of the typed time wins — documented
limitation.

### Visual selection in the chart

`PressureChart.setSelectedRange({ fromMs, toMs })` draws a translucent green
rectangle inside the chart area between the two pixel positions matching
those timestamps. The plugin draws on `afterDraw`, so it survives Chart.js
animations, zoom changes, and resize.

### Reset

`reset-period-selection` clears `selectedFrom/ToTimestampMs`, clears the
input texts, calls `chart.setSelectedRange(null)`, and triggers
recomputation against the full range.

## Range-filtering model (single source of filtering)

The UI applies the operator-selected range exactly once, in
`recomputeAnalysis(ctx)` (`src/app/events.ts`):

```ts
const rows = selectRowsInTimeRange(pr.rows, fromMs, toMs);
calculatePressureDrop(rows, channel, { targetPressure });
evaluateHoldPeriod(rows, channel, { targetPressure, maxDropPct });
```

`selectRowsInTimeRange` is the canonical domain helper. The downstream
analysis functions receive already-narrowed rows and we deliberately do
**not** also pass `fromTimestampMs` / `toTimestampMs` to `evaluateHoldPeriod`
in this code path. Doing both would silently work today (an already-filtered
list re-filtered with the same range is the same list), but it makes the
data-flow harder to reason about and would mask bugs where the two ranges
drift apart.

`evaluateHoldPeriod` retains its `fromTimestampMs` / `toTimestampMs` options
in the domain API for future callers who want range-aware hold evaluation
without going through the UI helper. The UI just doesn't use them.

## Manual QA checklist (before merge or release)

The smoke test exercises **manual period input** end to end (Fra/Til text
fields, including the shorter range and reset). It does **not** exercise the
**drag-select gesture** in the chart itself, because mouse-drag automation
in Electron + Playwright is flaky enough on CI that a green test would lower
confidence rather than raise it. Drag-select shares state and analysis code
paths with manual input via the same `handleChartPeriodSelected` callback,
so a bug in the analysis layer would still be caught by the manual-input
smoke. The gesture pixel-to-timestamp conversion is the only piece not
covered automatically.

Before merging this PR (or any future PR that touches the chart, period
inputs, or `recomputeAnalysis`), run through this manual checklist on a
real desktop:

1. `npm run electron:dev` (or `Start IHPU.bat`).
2. Upload `test-data/Dekk test Seal T.2`.
3. Confirm the chart renders both T1 and T2 lines.
4. **Wheel-zoom** in on the middle of the chart, confirm time-axis ticks
   update.
5. Click **Tilbakestill zoom** — the chart returns to full extent.
6. **Drag horizontally** across a portion of the chart from left to right.
   On mouseup:
   - The selected range gets a translucent green overlay.
   - `Valgt periode` updates with the dragged HH:MM:SS times.
   - `Periode-varighet` and the pressure summary recompute.
   - `Fra` / `Til` inputs reflect the dragged times.
7. Drag again **right to left** — confirm the result is normalised
   (`from <= to`).
8. Drag a tiny segment (under ~5 px) — confirm it is treated as an
   accidental click and is ignored (no selection appears).
9. Type a new value into `Fra` (e.g. `13:15:00`) — confirm the chart
   overlay updates and analysis recomputes.
10. Click **Tilbakestill periode** — confirm the overlay disappears, both
    inputs clear, and full-range metrics return.
11. Try an invalid time (e.g. `99:99`) — confirm `Meldinger` shows a
    `Chart: Ugyldig …` message and analysis does not crash.

If any of these fail, file a bug; do not merge.

## Canonical-fixture expectations (encoded in the smoke test)

After uploading `test-data/Dekk test Seal T.2`:

| Action | UI assertion |
|---|---|
| Initial (no period) | `selected-period-summary` = "Hele loggen (…)"; `pressure-drop-bar` ≈ 15.108 bar; `hold-status` = PASS |
| Set Fra=`13:10:37`, Til=`14:20:01` (full range) | `selected-period-duration` ≈ 69.4 min; metrics unchanged |
| Set Til=`13:20:00` | `selected-period-duration` matches `9.[0-9]+ min`; `pressure-drop-bar` is **not** 15.108; `hold-status` is one of PASS/FAIL/UNKNOWN (never empty/blank) |
| Click `reset-period-selection` | full-range metrics return; both inputs are empty |
| Click `reset-chart-zoom` | no error |

The smoke deliberately does **not** hardcode the exact short-period
pressure-drop-bar value. The contract is "it changes from the full-range
value" — the actual number depends on the fixture rows landing inside the
9-minute window, which the parser already exercises in detail.

## State extension

```ts
// AppState (additive)
selectedFromTimestampMs: number | null;
selectedToTimestampMs:   number | null;
selectedFromTimeText:    string;          // raw input text
selectedToTimeText:      string;
chartReady:              boolean;         // true after first successful Chart.js mount
chartError:              string | null;   // last chart-related error message
```

Both null timestamps means "use full parsed range" (the default after upload).

## Out of scope

- Hold-zone auto-detection (the app suggests where the hold period probably
  is). Future PR.
- Chart annotation plugin / labelled regions. The translucent rectangle is
  sufficient for v1.
- Multi-file overlay.
- Live tooltips with full readout (Chart.js default tooltip is enabled, but
  no custom formatter beyond the bar/timestamp readout).
- PDF / CSV export of the selected range.
- Custom date-range selection (logs spanning multiple days).
- Saving the selected period to disk between sessions.

## Known limitations

- Manual Fra/Til parses HH:MM or HH:MM:SS only. Date inputs are not
  supported — the date comes from `rows[0]`.
- For multi-day logs, the first row's date is used for both Fra and Til.
  Multi-day support is a separate PR.
- Drag-select on a heavily zoomed chart works on the visible portion only
  (zoom first, then drag inside the visible window — this is by design).
- Pinch zoom requires hammerjs at runtime. Hammerjs is in `dependencies`,
  but if a future PR removes it, pinch will silently no-op (wheel zoom still
  works).

## Next phase

Reports — CSV and PDF — both consume the same `HoldPeriodResult` produced by
`evaluateHoldPeriod`, including the operator-selected range. The CSV/PDF
must NOT recompute drop or drop %; they read what the dashboard sees.
