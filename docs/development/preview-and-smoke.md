# Preview and smoke harness

This project ships a preview + smoke-test harness so feature PRs can be verified
deterministically before review. The harness does **not** test full feature behaviour —
it confirms that each layer of the app comes up cleanly and renders the bootstrap shell.
Real feature acceptance (file upload, parser correctness, PDF export, Windows installer)
must still be tested separately.

## Tiers

| Tier | What it proves | Tooling |
|---|---|---|
| **Fixture integrity** | Canonical raw test data (`test-data/Dekk test Seal T.2`) is present, sha256-locked, and structurally a tab-separated trykktest log | `npm run smoke:fixture` |
| **Web preview** (dev) | Vite serves the renderer, TS transforms succeed, app shell renders | `npm run preview:web` |
| **Production preview** | Built `dist/` bundle works under `vite preview` (closer to packaged Electron) | `npm run preview:prod` |
| **Web smoke** | Same as preview:web but headless and asserts via `fetch` | `npm run smoke:web` |
| **Production smoke** | Same as preview:prod but headless and asserts on hashed bundle | `npm run smoke:prod` |
| **Electron smoke** | Real Electron window opens against `dist/index.html`, asserts title + bootstrap text + screenshot | `npm run smoke:electron` |
| **Verify (full)** | Build, unit tests, fixture, all three runtime smokes — single gate for PRs | `npm run verify` |

The Windows `.exe` / NSIS installer and the desktop shortcut are out of scope for the
harness — those are still validated by manually running `Start IHPU.bat` and, later,
the packaged installer on a real Windows desktop.

## Commands

### `npm run smoke:fixture`

The first gate in `npm run verify`. Reads `test-data/Dekk test Seal T.2`, asserts:

- File is non-empty.
- Size matches the canonical contract (`19266` bytes).
- sha256 matches the canonical hash (see [test-data-contract.md](test-data-contract.md)).
- More than 10 non-empty lines, at least one tab-separated, at least one with a
  `DD.MM.YYYY HH:MM` timestamp prefix.

Writes a JSON summary to `test-results/fixture-integrity.json`. Output ends with
`SMOKE FIXTURE PASS` or `SMOKE FIXTURE FAIL`. The same checks run as Vitest tests in
`tests/fixtureIntegrity.test.ts`, so `npm test` also catches a corrupted fixture.

### `npm run preview:web`

Starts Vite dev server bound to `127.0.0.1:5173` with `--strictPort`. Long-running.
Use this when you want to look at the renderer in a normal browser at
[http://127.0.0.1:5173](http://127.0.0.1:5173).

### `npm run preview:prod`

Runs `npm run build` then `vite preview` on `127.0.0.1:4173` with `--strictPort`. Long-running.
Use this to see what the production bundle (the same one Electron loads in packaged mode)
looks like in a regular browser.

### `npm run smoke:web`

Headless. Spawns Vite on `127.0.0.1:5173`, waits for HTTP 200, asserts:

- The served HTML contains `IHPU TrykkAnalyse` and `id="app"`.
- The transformed `/src/main.ts` contains `Bootstrap OK` and `Ingen data lastet`.

Server is killed in `finally`. Output ends with `SMOKE WEB PASS` or `SMOKE WEB FAIL`.

### `npm run smoke:prod`

Headless. Runs `npm run build` then spawns `vite preview` on `127.0.0.1:4173`, asserts:

- Preview HTML contains `IHPU TrykkAnalyse` and references `./assets/...` (relative
  paths required for `file://` loading by packaged Electron).
- The hashed JS bundle referenced from the HTML contains `Bootstrap OK`.

Server is killed in `finally`. Output ends with `SMOKE PROD PASS` or `SMOKE PROD FAIL`.

### `npm run smoke:electron`

Runs `npm run build`, then `playwright test tests/smoke/electron.spec.ts`. The test:

- Launches `dist-electron/main.js` directly via Playwright's `_electron.launch`.
- Sets `IHPU_FORCE_PROD=1` so Electron loads `dist/index.html` from disk instead of
  trying to reach the dev server.
- Waits for the first window, asserts the title matches `/IHPU TrykkAnalyse/`.
- Asserts `Bootstrap OK` and `Ingen data lastet` are visible.
- Saves a screenshot to `test-results/electron-bootstrap.png`.
- Closes the app cleanly.

### `npm run verify`

Runs the full chain in this order:

1. `npm run build`
2. `npm test` (Vitest, includes `tests/fixtureIntegrity.test.ts`)
3. `npm run smoke:fixture` (canonical fixture sha256 + size gate)
4. `npm run smoke:web`
5. `npm run smoke:prod`
6. `npm run smoke:electron`

This is the single command a feature PR must pass before push. The fixture gate runs
*before* the runtime smokes intentionally — if the canonical raw fixture is missing
or corrupted, there's no point spinning up Vite or Electron.

## Result classifications

The smoke scripts deliberately distinguish three outcomes:

| Result | Meaning | Action |
|---|---|---|
| **PASS** | Asserts succeeded | Continue |
| **FAIL** | App or build is broken | Fix the underlying issue, do not merge |
| **SKIPPED-NO-GUI** / **BLOCKED-NO-GUI** | Environment cannot run the test (no display, headless CI) | Document and continue; **do not** treat as evidence the app works or as evidence it is broken |

Currently only `smoke:electron` can produce a no-GUI result, and only when run on a
host that lacks a display server. On a local Windows desktop it should always either
PASS or FAIL on real evidence.

## Test data contract

`smoke:fixture` and `tests/fixtureIntegrity.test.ts` enforce a sha256 + size lock on
`test-data/Dekk test Seal T.2`. See [test-data-contract.md](test-data-contract.md) for
the rules around editing, replacing, or adding fixtures. Short version: don't edit
the canonical file in place, and changes to the contract require their own PR.

## Ports

| Port | Used by |
|---|---|
| 5173 | `dev`, `preview:web`, `smoke:web` |
| 4173 | `preview:prod`, `smoke:prod` |

`--strictPort` ensures Vite refuses to fall back to a different port on conflict — better
to fail loudly than to bind a random port the smoke script then can't find.

## What the harness does NOT cover

- Pressure-test file parsing (`src/domain/ihpuParser.ts`) — covered by Vitest unit tests
  once the parser is migrated.
- Pressure analysis, hold-period detection — same.
- Chart.js wiring, CSV export, PDF report — separate verification per phase.
- Windows file picker, OS file dialogs, drag-and-drop — must be tested manually.
- The packaged `.exe` / NSIS installer — must be tested manually on a real Windows
  machine before any release.
- `Start IHPU.bat` invocation flow — manual smoke before tagging a release.
