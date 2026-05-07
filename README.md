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

## Migration roadmap

1. ~~Bootstrap structure~~ (done)
2. Pure-TypeScript parser in `src/domain/ihpuParser.ts` (no DOM) + Vitest coverage against `test-data/Dekk test Seal T.2`
3. Pressure analysis + hold-period detection
4. Chart wiring
5. CSV / PDF reports
6. UI polish, app icon, signed installer
