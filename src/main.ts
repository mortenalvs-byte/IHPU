import './styles/app.css';
import { PressureChart } from './charts/pressureChart';
import { handleChartPeriodSelected, restoreSessionOnStartup, wireEvents } from './app/events';
import { mountAppShell } from './app/render';
import { createState, type AppState } from './app/state';

// Smoke-test source markers — these literal strings must remain in src/main.ts
// so scripts/smoke-web.mjs (which probes the dev-transformed module) and
// scripts/smoke-prod.mjs (which probes the production bundle) can verify that
// the app shell loaded the expected initial copy. They are also the source of
// truth for the "app is ready" indicator and the "no file loaded" status.
const APP_SHELL_MARKERS = {
  appReady: 'Bootstrap OK',
  fileStatusInitial: 'Ingen data lastet'
} as const;

interface AppContext {
  root: HTMLElement;
  state: AppState;
  chart: PressureChart;
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root element');
}

const state = createState();
mountAppShell(root, APP_SHELL_MARKERS);

const canvas = root.querySelector<HTMLCanvasElement>('[data-testid="pressure-chart"]');
if (!canvas) {
  throw new Error('Missing pressure-chart canvas');
}

// `ctx` is forward-declared because the chart callback needs to capture it,
// but the chart instance itself is part of the context. The callback only
// fires on user gestures — by then the assignment below has run.
let ctx!: AppContext;

const chart = new PressureChart(canvas, {
  onPeriodSelected: (range) => handleChartPeriodSelected(ctx, range)
});

ctx = { root, state, chart };

wireEvents(ctx);

// Try to restore the operator's last session from localStorage. Internally
// runs `applyActiveSource(ctx)` so a manual-mode restore re-populates the
// chart and analysis pipeline from the saved manual rows. Always renders
// at the end — no separate render() call needed.
restoreSessionOnStartup(ctx);
