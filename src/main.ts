import './styles/app.css';
import { wireEvents } from './app/events';
import { mountAppShell, render } from './app/render';
import { createState } from './app/state';

// Smoke-test source markers — these literal strings must remain in src/main.ts
// so scripts/smoke-web.mjs (which probes the dev-transformed module) and
// scripts/smoke-prod.mjs (which probes the production bundle) can verify that
// the app shell loaded the expected initial copy. They are also the source of
// truth for the "app is ready" indicator and the "no file loaded" status.
const APP_SHELL_MARKERS = {
  appReady: 'Bootstrap OK',
  fileStatusInitial: 'Ingen data lastet'
} as const;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root element');
}

const state = createState();
mountAppShell(root, APP_SHELL_MARKERS);
wireEvents({ root, state });
render(root, state);
