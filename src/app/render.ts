// render.ts — pushes AppState into the DOM.
//
// All dynamic text goes through `setText`, which uses `textContent` and
// therefore CANNOT execute markup contained in user-controlled strings
// (e.g. a malicious filename). The static layout HTML in `mountAppShell` is
// developer-authored and contains no user data, so innerHTML is safe there.

import type { AppState } from './state';

export interface AppShellMarkers {
  /** Visible app-ready marker. Used by smoke tests as a "renderer is alive" check. */
  appReady: string;
  /** Initial copy in the file-status field before the user picks a file. */
  fileStatusInitial: string;
}

/**
 * Replace the contents of `root` with the static app shell. Called once at
 * startup. The markup uses only developer-authored literals — every dynamic
 * value is filled in afterwards via `render()` using textContent.
 */
export function mountAppShell(root: HTMLElement, markers: AppShellMarkers): void {
  root.innerHTML = `
    <header class="app-header">
      <h1 data-testid="app-title">IHPU TrykkAnalyse</h1>
      <p class="subtitle">Trykktestanalyse — desktop</p>
    </header>
    <main class="app-main">
      <p class="app-ready" data-testid="app-ready">${escapeForStaticTemplate(markers.appReady)}</p>

      <section class="upload-section">
        <h2>Last opp trykktestlogg</h2>
        <input type="file" data-testid="file-input" accept=".txt,.csv,.dat,.tsv,.log" />
        <p class="file-status" data-testid="file-status">${escapeForStaticTemplate(
          markers.fileStatusInitial
        )}</p>
      </section>

      <section class="card file-summary-section">
        <h2>Filsammendrag</h2>
        <dl class="summary-grid">
          <dt>Filnavn</dt>          <dd data-testid="file-name">—</dd>
          <dt>Antall rader</dt>     <dd data-testid="parsed-row-count">—</dd>
          <dt>Warnings</dt>         <dd data-testid="parse-warning-count">—</dd>
          <dt>Errors</dt>           <dd data-testid="parse-error-count">—</dd>
          <dt>Første tidspunkt</dt> <dd data-testid="first-timestamp">—</dd>
          <dt>Siste tidspunkt</dt>  <dd data-testid="last-timestamp">—</dd>
          <dt>Varighet</dt>         <dd data-testid="duration-minutes">—</dd>
          <dt>T1 (p1)</dt>          <dd data-testid="channel-p1-present">—</dd>
          <dt>T2 (p2)</dt>          <dd data-testid="channel-p2-present">—</dd>
        </dl>
      </section>

      <section class="card controls-section">
        <h2>Analyse-kontroller</h2>
        <div class="controls-grid">
          <label>
            <span>Kanal</span>
            <select data-testid="channel-select">
              <option value="p2">T2 (p2)</option>
              <option value="p1">T1 (p1)</option>
            </select>
          </label>
          <label>
            <span>Max drop %</span>
            <input type="number" data-testid="max-drop-input" value="5" step="0.1" min="0" inputmode="decimal" />
          </label>
          <label>
            <span>Target pressure (bar, valgfri)</span>
            <input type="number" data-testid="target-pressure-input" step="0.001" inputmode="decimal" placeholder="ingen" />
          </label>
        </div>
      </section>

      <section class="card pressure-summary-section">
        <h2>Trykksammendrag</h2>
        <dl class="summary-grid">
          <dt>Starttrykk</dt>            <dd data-testid="pressure-start">—</dd>
          <dt>Slutttrykk</dt>            <dd data-testid="pressure-end">—</dd>
          <dt>Trykkfall</dt>             <dd data-testid="pressure-drop-bar">—</dd>
          <dt>Drop % av start</dt>       <dd data-testid="pressure-drop-pct-start">—</dd>
          <dt>Drop % av target</dt>      <dd data-testid="pressure-drop-pct-target">—</dd>
          <dt>Rate (bar/min)</dt>        <dd data-testid="pressure-rate-minute">—</dd>
          <dt>Rate (bar/hour)</dt>       <dd data-testid="pressure-rate-hour">—</dd>
          <dt>Trykket økte?</dt>         <dd data-testid="pressure-increased">—</dd>
        </dl>
      </section>

      <section class="card chart-section">
        <h2>Trykkforløp</h2>
        <div class="chart-container">
          <canvas data-testid="pressure-chart" aria-label="Pressure log chart"></canvas>
        </div>
        <p class="chart-hint" data-testid="chart-drag-hint">Klikk og dra horisontalt i grafen for å velge trykktestperiode.</p>
        <p class="chart-status" data-testid="chart-status">Venter på data</p>

        <div class="period-controls">
          <label>
            <span>Fra (HH:MM:SS)</span>
            <input type="text" data-testid="period-from-input" placeholder="13:10:37" autocomplete="off" />
          </label>
          <label>
            <span>Til (HH:MM:SS)</span>
            <input type="text" data-testid="period-to-input" placeholder="14:20:01" autocomplete="off" />
          </label>
          <button type="button" data-testid="reset-period-selection">Tilbakestill periode</button>
          <button type="button" data-testid="reset-chart-zoom">Tilbakestill zoom</button>
        </div>

        <dl class="summary-grid">
          <dt>Valgt periode</dt>           <dd data-testid="selected-period-summary">Hele loggen</dd>
          <dt>Periode-varighet</dt>        <dd data-testid="selected-period-duration">—</dd>
          <dt>Periode starttrykk</dt>      <dd data-testid="selected-period-start-pressure">—</dd>
          <dt>Periode slutttrykk</dt>      <dd data-testid="selected-period-end-pressure">—</dd>
        </dl>
      </section>

      <section class="card hold-section">
        <h2>Holdperiode-resultat</h2>
        <p class="hold-status hold-unknown" data-testid="hold-status">—</p>
        <dl class="summary-grid">
          <dt>Brukt drop %</dt>    <dd data-testid="hold-used-drop-pct">—</dd>
          <dt>Tillatt drop %</dt>  <dd data-testid="hold-allowed-drop-pct">—</dd>
          <dt>Margin</dt>          <dd data-testid="hold-margin-pct">—</dd>
        </dl>
      </section>

      <section class="card issues-section">
        <h2>Meldinger</h2>
        <p data-testid="issue-summary">Ingen meldinger</p>
      </section>
    </main>
  `;
}

/**
 * Push AppState into the DOM. Called on every state change. All dynamic
 * fields go through `setText` which uses textContent.
 */
export function render(root: HTMLElement, state: AppState): void {
  // File status banner
  setText(
    root,
    'file-status',
    state.selectedFileName ? `Lastet: ${state.selectedFileName}` : 'Ingen data lastet'
  );

  // File summary
  const pr = state.parseResult;
  setText(root, 'file-name', state.selectedFileName ?? '—');
  setText(root, 'parsed-row-count', pr ? String(pr.meta.parsedRows) : '—');
  setText(root, 'parse-warning-count', pr ? String(pr.warnings.length) : '—');
  setText(root, 'parse-error-count', pr ? String(pr.errors.length) : '—');

  const firstIso = pr && pr.rows.length > 0 ? pr.rows[0].localIso : null;
  const lastIso = pr && pr.rows.length > 0 ? pr.rows[pr.rows.length - 1].localIso : null;
  setText(root, 'first-timestamp', firstIso ?? '—');
  setText(root, 'last-timestamp', lastIso ?? '—');
  setText(root, 'duration-minutes', fmtDuration(pr?.meta.durationMinutes ?? null));

  setText(root, 'channel-p1-present', presenceText(pr?.meta.channelsPresent.p1));
  setText(root, 'channel-p2-present', presenceText(pr?.meta.channelsPresent.p2));

  // Pressure summary
  const drop = state.baselineDrop;
  setText(root, 'pressure-start', fmtPressure(drop?.startPressure ?? null));
  setText(root, 'pressure-end', fmtPressure(drop?.endPressure ?? null));
  setText(root, 'pressure-drop-bar', fmtPressure(drop?.dropBar ?? null));
  setText(root, 'pressure-drop-pct-start', fmtPercent(drop?.dropPct ?? null));
  setText(root, 'pressure-drop-pct-target', fmtPercent(state.targetDrop?.dropPct ?? null));
  setText(root, 'pressure-rate-minute', fmtRate(drop?.dropBarPerMinute ?? null, 'bar/min'));
  setText(root, 'pressure-rate-hour', fmtRate(drop?.dropBarPerHour ?? null, 'bar/hour'));
  setText(
    root,
    'pressure-increased',
    drop?.dropBar === null || drop?.dropBar === undefined ? '—' : drop.dropBar < 0 ? 'Ja' : 'Nei'
  );

  // Chart + period selection
  setText(root, 'chart-status', resolveChartStatus(state));
  setText(root, 'selected-period-summary', resolvePeriodSummary(state));
  setText(root, 'selected-period-duration', fmtDuration(drop?.durationMinutes ?? null));
  setText(root, 'selected-period-start-pressure', fmtPressure(drop?.startPressure ?? null));
  setText(root, 'selected-period-end-pressure', fmtPressure(drop?.endPressure ?? null));

  syncPeriodInputs(root, state);

  // Hold result
  const hold = state.holdResult;
  const usedDropPct = hold?.drop.dropPct ?? null;
  setText(root, 'hold-status', hold?.status ?? '—');
  setText(root, 'hold-used-drop-pct', fmtPercent(usedDropPct));
  setText(root, 'hold-allowed-drop-pct', fmtPercent(state.maxDropPct));
  setText(
    root,
    'hold-margin-pct',
    fmtPercent(usedDropPct !== null ? state.maxDropPct - usedDropPct : null)
  );

  setHoldStatusClass(root, hold?.status ?? null);

  // Issues
  setText(root, 'issue-summary', composeIssueSummary(state));
}

// ---------- helpers ----------

function setText(root: HTMLElement, testId: string, value: string): void {
  const el = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el) el.textContent = value;
}

function fmtPressure(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(3) + ' bar';
}

function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4) + ' %';
}

function fmtDuration(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(1) + ' min';
}

function fmtRate(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(4) + ' ' + unit;
}

function presenceText(present: boolean | undefined): string {
  if (present === undefined) return '—';
  return present ? 'tilstede' : 'mangler';
}

function setHoldStatusClass(root: HTMLElement, status: string | null): void {
  const el = root.querySelector<HTMLElement>('[data-testid="hold-status"]');
  if (!el) return;
  el.classList.remove('hold-pass', 'hold-fail', 'hold-unknown');
  if (status === 'PASS') el.classList.add('hold-pass');
  else if (status === 'FAIL') el.classList.add('hold-fail');
  else el.classList.add('hold-unknown');
}

function composeIssueSummary(state: AppState): string {
  const messages: string[] = [];
  if (state.userMessage) messages.push(state.userMessage.text);
  if (state.chartError) messages.push(`Chart: ${state.chartError}`);
  const pr = state.parseResult;
  if (pr) {
    if (pr.errors.length > 0) {
      messages.push(`Parser errors: ${pr.errors.length} (første: ${pr.errors[0].message})`);
    }
    if (pr.warnings.length > 0) {
      messages.push(`Parser warnings: ${pr.warnings.length}`);
    }
  }
  const drop = state.baselineDrop;
  if (drop && drop.errors.length > 0) {
    messages.push(`Analyse: ${drop.errors[0].message}`);
  }
  return messages.length === 0 ? 'Ingen meldinger' : messages.join(' · ');
}

function resolveChartStatus(state: AppState): string {
  if (state.chartError) return state.chartError;
  if (state.chartReady) return 'Klar';
  if (state.parseResult && state.parseResult.rows.length > 0) return 'Tegner …';
  return 'Venter på data';
}

function resolvePeriodSummary(state: AppState): string {
  const fromMs = state.selectedFromTimestampMs;
  const toMs = state.selectedToTimestampMs;
  const pr = state.parseResult;

  if (fromMs === null && toMs === null) {
    if (pr && pr.rows.length > 0) {
      const first = pr.rows[0].timeText || pr.rows[0].localIso.slice(11);
      const last =
        pr.rows[pr.rows.length - 1].timeText || pr.rows[pr.rows.length - 1].localIso.slice(11);
      return `Hele loggen (${first} → ${last})`;
    }
    return 'Hele loggen';
  }

  const fromText = fromMs !== null ? msToTimeText(fromMs) : 'start';
  const toText = toMs !== null ? msToTimeText(toMs) : 'slutt';
  return `${fromText} → ${toText}`;
}

function syncPeriodInputs(root: HTMLElement, state: AppState): void {
  const fromInput = root.querySelector<HTMLInputElement>('[data-testid="period-from-input"]');
  const toInput = root.querySelector<HTMLInputElement>('[data-testid="period-to-input"]');
  if (fromInput && fromInput.value !== state.selectedFromTimeText) {
    // Only update if the user is not currently typing in this field.
    if (document.activeElement !== fromInput) {
      fromInput.value = state.selectedFromTimeText;
    }
  }
  if (toInput && toInput.value !== state.selectedToTimeText) {
    if (document.activeElement !== toInput) {
      toInput.value = state.selectedToTimeText;
    }
  }
}

function msToTimeText(ms: number): string {
  // The deterministic timestampMs is built with Date.UTC, so reading via UTC
  // round-trips the wall-clock time the parser saw.
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export { msToTimeText };

/**
 * Defensive escape for the static template. Even though the only inputs come
 * from main.ts (developer-authored marker config), running them through this
 * makes it impossible to accidentally inject HTML if a future caller wires
 * user data in here.
 */
function escapeForStaticTemplate(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
