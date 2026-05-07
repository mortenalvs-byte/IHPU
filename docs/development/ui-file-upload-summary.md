# UI: file upload + analysis summary

This is the first real UI integration. The Electron renderer now consumes the
parser and pressure-analysis domain layers and shows the result. There is no
chart, no PDF, and no CSV in this slice — those come later.

## Data flow

```
file input change
    │
    ▼
File.text()                         (renderer API)
    │
    ▼
parseIhpuPressureLog(text, ...)     (src/domain/ihpuParser.ts)
    │
    ▼
calculatePressureDrop(rows, ...)    (src/domain/pressureAnalysis.ts)
calculatePressureDrop(rows, ..., target) when targetPressure is set
evaluateHoldPeriod(rows, ..., {targetPressure, maxDropPct})  (src/domain/holdPeriod.ts)
    │
    ▼
AppState                            (src/app/state.ts)
    │
    ▼
render(root, state)                 (src/app/render.ts)
    │
    ▼
DOM textContent updates
```

The renderer never re-derives numbers from raw rows. Every value the user
sees is the `dropBar`, `dropPct`, `durationMinutes`, etc. produced by the
domain layer. Future layers (chart, CSV, PDF) will consume the same
`PressureDropResult` / `HoldPeriodResult` for the same reason — single source
of truth.

## Modules

| File | Role |
|---|---|
| `src/main.ts` | Bootstraps state, mounts shell, wires events, renders. Holds the literal smoke markers `Bootstrap OK` and `Ingen data lastet` so `smoke:web` / `smoke:prod` find them in the bundle. |
| `src/app/state.ts` | `AppState` shape + `createState()` with defaults: channel `p2`, `maxDropPct: 5`, `targetPressure: null`. |
| `src/app/render.ts` | `mountAppShell()` writes the static layout once. `render(root, state)` updates every dynamic field via `textContent`. |
| `src/app/events.ts` | Wires file input, channel select, max-drop input, target-pressure input. On any change, `recomputeAnalysis(ctx)` runs the domain functions and `render(...)` pushes the result. |

## Why no innerHTML for user data

`render.ts` exposes one helper, `setText`, which sets `textContent` on the
element matching `[data-testid="..."]`. Every dynamic value — including the
filename and parser error messages — flows through `setText`. A malicious
`.txt` file (or a filename containing `<script>`) cannot inject markup into
the renderer.

`mountAppShell()` is the only place that uses `innerHTML`, and it does so
with a developer-authored template literal. The two values it interpolates
(`appReady`, `fileStatusInitial`) come from `src/main.ts` and are run through
a defensive HTML escape before injection.

## Default analysis configuration

| Field | Default |
|---|---|
| Channel | `p2` (T2) |
| `maxDropPct` | `5` (percent points — see `pressure-analysis-contract.md`) |
| `targetPressure` | `null` (drop is calculated against `startPressure`) |
| Time range | full parsed log |

The user can change all of these. Each input fires a re-analysis on every
keystroke, so the summary stays in sync with whatever is on screen.

## Canonical fixture UI values

When `test-data/Dekk test Seal T.2` is loaded with default settings:

| Field | Value |
|---|---|
| `parsed-row-count` | 461 |
| `parse-error-count` | 0 |
| `parse-warning-count` | 0 |
| `duration-minutes` | 69.4 min |
| `pressure-start` | 314.387 bar |
| `pressure-end` | 299.279 bar |
| `pressure-drop-bar` | 15.108 bar |
| `pressure-drop-pct-start` | 4.8055 % |
| `pressure-rate-minute` | 0.2177 bar/min |
| `pressure-rate-hour` | 13.0616 bar/hour |
| `pressure-increased` | Nei |
| `hold-status` | PASS |
| `hold-used-drop-pct` | 4.8055 % |
| `hold-allowed-drop-pct` | 5.0000 % |
| `hold-margin-pct` | 0.1945 % |

After tightening `max-drop-input` to `4`:

| Field | Value |
|---|---|
| `hold-status` | FAIL |
| `hold-allowed-drop-pct` | 4.0000 % |

After setting `target-pressure-input` to `315` (with `max-drop-input` back at 5):

| Field | Value |
|---|---|
| `pressure-drop-pct-target` | 4.7962 % |
| `hold-status` | PASS |
| `hold-used-drop-pct` | 4.7962 % (now using target reference) |

## Smoke test

`tests/smoke/electron.spec.ts` exercises the full flow end-to-end:

1. Launch Electron (forced production-mode load via `IHPU_FORCE_PROD=1`).
2. Assert initial shell: title, `app-ready`, `file-status` initial copy,
   `file-input` enabled.
3. `setInputFiles(...)` with the canonical fixture path.
4. Assert all summary numbers above.
5. Change `max-drop-input` → assert `hold-status` becomes `FAIL`.
6. Restore + set target `315` → assert `pressure-drop-pct-target` and that
   `hold-status` is `PASS` again.
7. Save `test-results/electron-file-upload-summary.png`.
8. Close the app cleanly.

Selectors all use `data-testid` so a future visual redesign can move things
around without breaking the smoke.

## Stable data-testid contract

This PR introduces these test IDs. They are part of the harness contract —
later UI PRs may add more, but should not rename or remove these without a
deliberate, documented update of the smoke test.

```
app-title                  app-ready
file-input                 file-status
file-name                  parsed-row-count
parse-warning-count        parse-error-count
first-timestamp            last-timestamp
duration-minutes           channel-p1-present
channel-p2-present
channel-select             max-drop-input
target-pressure-input
pressure-start             pressure-end
pressure-drop-bar          pressure-drop-pct-start
pressure-drop-pct-target   pressure-rate-minute
pressure-rate-hour         pressure-increased
hold-status                hold-used-drop-pct
hold-allowed-drop-pct      hold-margin-pct
issue-summary
```

## Number formatting

Internal values are never rounded. Display formatting only:

| Kind | Decimals |
|---|---|
| Pressure (bar) | 3 |
| Drop bar | 3 |
| Percent | 4 |
| Duration (min) | 1 |
| Rate (bar/min, bar/hour) | 4 |

Null or non-finite values render as `—`.

## Out of scope

- Chart.js rendering — next PR
- CSV / PDF export
- Manual data entry
- Multi-file overlay
- Hold-zone auto-detection
- Customizable time-range selection in UI (the API supports it via
  `evaluateHoldPeriod` criteria, but the UI just uses the full parsed range
  for now)
- Persisted preferences (no localStorage in this PR)
- Sending file content anywhere (everything stays in-process)

## Known limitations

- The file-status banner shows `Lastet: <filename>`. The filename comes from
  `File.name` which is user-controlled — it's set via `textContent` so
  cannot inject markup, but a very long filename will visually overflow.
  A future polish PR can clip it.
- Pressing Enter in numeric inputs does not submit anything (there is no
  form). Values apply on every keystroke.
- If the parser produces zero rows (e.g. user picks an unrelated file), the
  pressure summary, hold, and most dl entries show `—`. The `issue-summary`
  surfaces the parser's `NO_VALID_ROWS` error so the user knows why.
