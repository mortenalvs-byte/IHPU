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

## Migration roadmap

1. ~~Bootstrap structure~~ (done)
2. ~~Preview / smoke / fixture integrity harness~~ (done)
3. ~~Pure-TypeScript parser in `src/domain/ihpuParser.ts` + Vitest coverage against `test-data/Dekk test Seal T.2`~~ (done)
4. Pressure analysis + hold-period detection
5. Chart wiring
6. CSV / PDF reports
7. UI polish, app icon, signed installer
