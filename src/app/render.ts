// render.ts — pushes AppState into the DOM.
//
// All dynamic text goes through `setText`, which uses `textContent` and
// therefore CANNOT execute markup contained in user-controlled strings
// (e.g. a malicious filename). The static layout HTML in `mountAppShell` is
// developer-authored and contains no user data, so innerHTML is safe there.

import { computeOverlayComparison } from '../domain/overlay';
import type { HoldPeriodCriteria } from '../domain/types';
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

      <section class="card session-section" data-testid="session-section">
        <h2>Test-økt</h2>
        <div class="session-actions">
          <button type="button" data-testid="new-test-button">Ny test</button>
          <button type="button" data-testid="export-session-button">Eksporter session</button>
          <label class="import-session-label">
            <input type="file" accept="application/json,.json" data-testid="import-session-input" />
            <span>Importer session</span>
          </label>
        </div>
        <p class="session-status" data-testid="session-status">Ingen lagret økt.</p>
        <p class="autosave-status" data-testid="autosave-status">Aldri lagret</p>
        <p class="session-dirty-indicator" data-testid="session-dirty-indicator">—</p>
        <p class="session-source-summary" data-testid="session-source-summary">—</p>
      </section>

      <section class="card data-source-section">
        <h2>Datakilde</h2>
        <div class="data-source-mode" data-testid="data-source-mode">
          <label>
            <input type="radio" name="data-source-mode" value="file" checked />
            Fil-opplasting
          </label>
          <label>
            <input type="radio" name="data-source-mode" value="manual" />
            Manuell registrering
          </label>
        </div>

        <div class="upload-section" data-testid="upload-section">
          <h3>Last opp trykktestlogg</h3>
          <input type="file" data-testid="file-input" accept=".txt,.csv,.dat,.tsv,.log" />
          <p class="file-status" data-testid="file-status">${escapeForStaticTemplate(
            markers.fileStatusInitial
          )}</p>
        </div>

        <div class="manual-entry-section" data-testid="manual-entry-section">
          <h3>Manuell registrering</h3>

          <div class="manual-add-row">
            <label><span>Dato</span><input type="text" data-testid="manual-date-input" placeholder="DD.MM.YYYY" autocomplete="off" /></label>
            <label><span>Tid</span><input type="text" data-testid="manual-time-input" placeholder="HH:MM:SS" autocomplete="off" /></label>
            <label><span>T1 (bar)</span><input type="text" data-testid="manual-p1-input" placeholder="—" autocomplete="off" /></label>
            <label><span>T2 (bar)</span><input type="text" data-testid="manual-p2-input" placeholder="—" autocomplete="off" /></label>
            <button type="button" data-testid="manual-add-row-button">Legg til rad</button>
          </div>

          <div class="manual-paste-block">
            <label>
              <span>Lim inn tabelltekst (DD.MM.YYYY HH:MM:SS&lt;TAB&gt;T1&lt;TAB&gt;T2)</span>
              <textarea data-testid="manual-paste-input" rows="3" placeholder="21.02.2026 13:10:37	-2.96	314.39"></textarea>
            </label>
            <button type="button" data-testid="manual-paste-button">Importer fra paste</button>
          </div>

          <div class="manual-summary">
            <span>Antall rader: <strong data-testid="manual-row-count">0</strong></span>
            <p class="manual-validation-errors" data-testid="manual-validation-errors">Ingen rader registrert.</p>
          </div>

          <div class="manual-table-wrapper">
            <table class="manual-table" data-testid="manual-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Dato</th>
                  <th>Tid</th>
                  <th>T1</th>
                  <th>T2</th>
                  <th></th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>

          <div class="manual-actions">
            <button type="button" data-testid="manual-use-rows-button">Bruk manuelle rader</button>
            <button type="button" data-testid="manual-clear-rows">Tøm manuelle rader</button>
          </div>
        </div>
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
          <dt>Hele logg</dt>               <dd data-testid="full-log-summary">—</dd>
          <dt>Valgt periode</dt>           <dd data-testid="selected-period-summary">Hele loggen</dd>
          <dt>Periode-varighet</dt>        <dd data-testid="selected-period-duration">—</dd>
          <dt>Periode starttrykk</dt>      <dd data-testid="selected-period-start-pressure">—</dd>
          <dt>Periode slutttrykk</dt>      <dd data-testid="selected-period-end-pressure">—</dd>
        </dl>
      </section>

      <section class="card hold-section">
        <h2>Holdperiode-resultat</h2>
        <p class="hold-status hold-unknown" data-testid="hold-status">—</p>
        <p class="hold-narrative" data-testid="hold-narrative">Ingen evaluering ennå — last data og sett kriterier.</p>
        <dl class="summary-grid">
          <dt>Brukt drop %</dt>    <dd data-testid="hold-used-drop-pct">—</dd>
          <dt>Tillatt drop %</dt>  <dd data-testid="hold-allowed-drop-pct">—</dd>
          <dt>Margin</dt>          <dd data-testid="hold-margin-pct">—</dd>
        </dl>
      </section>

      <section class="card overlay-section" data-testid="overlay-section">
        <h2>Sammenlign tester</h2>
        <p class="overlay-intro">Last opp ekstra trykktest-logger for sammenligning. Påvirker ikke aktiv analyse.</p>

        <div class="overlay-actions">
          <label class="overlay-upload">
            <span>Legg til fil(er) i sammenligning</span>
            <input
              type="file"
              multiple
              data-testid="overlay-file-input"
              accept=".txt,.csv,.dat,.tsv,.log"
            />
          </label>
          <button type="button" data-testid="overlay-clear-button">Tøm sammenligning</button>
        </div>

        <p class="overlay-status" data-testid="overlay-status">Ingen sammenligningsfiler lastet ennå.</p>
        <p class="overlay-summary" data-testid="overlay-summary">0 filer i sammenligning</p>

        <div class="overlay-table-wrapper">
          <table class="overlay-table" data-testid="overlay-table">
            <thead>
              <tr>
                <th>Filnavn</th>
                <th>Rader</th>
                <th>Varighet</th>
                <th>T2 start</th>
                <th>T2 slutt</th>
                <th>T2 drop bar</th>
                <th>T2 drop %</th>
                <th>T2 verdikt</th>
                <th>T1 verdikt</th>
                <th>Lagt til</th>
                <th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </section>

      <section class="card report-section" data-testid="report-section">
        <h2>Kunderapport</h2>

        <div class="report-form">
          <label>
            <span>Kundenavn</span>
            <input type="text" data-testid="report-customer-input" autocomplete="off" />
          </label>
          <label>
            <span>Prosjektnummer</span>
            <input type="text" data-testid="report-project-input" autocomplete="off" />
          </label>
          <label>
            <span>Lokasjon</span>
            <input type="text" data-testid="report-location-input" autocomplete="off" />
          </label>
          <label>
            <span>Test-dato</span>
            <input type="text" data-testid="report-test-date-input" placeholder="DD.MM.YYYY" autocomplete="off" />
          </label>
          <label>
            <span>IHPU serienummer</span>
            <input type="text" data-testid="report-ihpu-serial-input" autocomplete="off" />
          </label>
          <label>
            <span>ROV-system</span>
            <input type="text" data-testid="report-rov-system-input" autocomplete="off" />
          </label>
          <label>
            <span>Operatør</span>
            <input type="text" data-testid="report-operator-input" autocomplete="off" />
          </label>
          <label class="report-form-comment">
            <span>Kommentar / merknad</span>
            <textarea data-testid="report-comment-input" rows="3"></textarea>
          </label>
        </div>

        <dl class="summary-grid report-preview-grid">
          <dt>Status for eksport</dt>     <dd data-testid="report-preview-status">Ingen data lastet</dd>
          <dt>Resultat</dt>               <dd data-testid="report-result-status">—</dd>
          <dt>Valgt periode</dt>          <dd data-testid="report-selected-period">—</dd>
          <dt>Kanal</dt>                  <dd data-testid="report-channel">—</dd>
          <dt>Drop-sammendrag</dt>        <dd data-testid="report-drop-summary">—</dd>
        </dl>

        <div class="export-actions">
          <button type="button" data-testid="export-csv-button" disabled>Eksporter CSV</button>
          <button type="button" data-testid="export-pdf-button" disabled>Eksporter PDF</button>
        </div>
        <p class="export-status" data-testid="export-status">Ingen eksport ennå</p>
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
  // File status banner. The empty-state copy mirrors the initial mount
  // marker so it tells the operator what to do next ("velg .txt/... eller
  // bruk Manuell registrering"), not just that nothing is loaded.
  setText(
    root,
    'file-status',
    state.selectedFileName
      ? `Lastet: ${state.selectedFileName}`
      : 'Ingen data lastet — velg .txt/.csv/.dat/.tsv/.log, eller bruk Manuell registrering.'
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
  setText(root, 'full-log-summary', resolveFullLogSummary(state));
  setText(root, 'selected-period-summary', resolvePeriodSummary(state));
  setText(root, 'selected-period-duration', fmtDuration(drop?.durationMinutes ?? null));
  setText(root, 'selected-period-start-pressure', fmtPressure(drop?.startPressure ?? null));
  setText(root, 'selected-period-end-pressure', fmtPressure(drop?.endPressure ?? null));

  syncPeriodInputs(root, state);
  syncControlInputs(root, state);

  // Hold result
  const hold = state.holdResult;
  const usedDropPct = hold?.drop.dropPct ?? null;
  setText(root, 'hold-status', hold?.status ?? '—');
  setText(root, 'hold-narrative', composeHoldNarrative(state));
  setText(root, 'hold-used-drop-pct', fmtPercent(usedDropPct));
  setText(root, 'hold-allowed-drop-pct', fmtPercent(state.maxDropPct));
  setText(
    root,
    'hold-margin-pct',
    fmtPercent(usedDropPct !== null ? state.maxDropPct - usedDropPct : null)
  );

  setHoldStatusClass(root, hold?.status ?? null);
  setHoldNarrativeClass(root, hold?.status ?? null);
  setUploadNeedsFileClass(root, state);

  // Report section + export buttons
  renderReportSection(root, state);

  // Manual entry section (radios + table + validation summary)
  renderManualSection(root, state);

  // Multi-file comparison section (separate from primary analysis)
  renderOverlaySection(root, state);

  // Session section (autosave + restore + new/import/export status)
  renderSessionSection(root, state);

  // Issues
  setText(root, 'issue-summary', composeIssueSummary(state));
}

function renderOverlaySection(root: HTMLElement, state: AppState): void {
  setText(root, 'overlay-status', state.overlay.addStatus.message);

  const criteria: HoldPeriodCriteria = {
    targetPressure:
      state.targetPressure !== null && Number.isFinite(state.targetPressure)
        ? state.targetPressure
        : undefined,
    maxDropPct: state.maxDropPct
  };
  const comparison = computeOverlayComparison(state.overlay.entries, criteria);

  setText(root, 'overlay-summary', composeOverlaySummary(comparison.entryCount, comparison));

  const table = root.querySelector<HTMLTableElement>('[data-testid="overlay-table"]');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  comparison.entries.forEach((vm) => {
    const tr = document.createElement('tr');
    tr.dataset.entryId = vm.id;
    tr.setAttribute('data-testid', 'overlay-row');

    appendCell(tr, vm.filename);
    appendCell(tr, String(vm.rowCount));
    appendCell(tr, fmtDuration(vm.durationMinutes));
    appendCell(tr, vm.p2 ? fmtPressure(vm.p2.startBar) : '—');
    appendCell(tr, vm.p2 ? fmtPressure(vm.p2.endBar) : '—');
    appendCell(tr, vm.p2 ? fmtPressure(vm.p2.dropBar) : '—');

    // T2 drop % cell with optional best/worst marker.
    const dropPctCell = document.createElement('td');
    if (vm.p2) {
      dropPctCell.textContent = fmtPercent(vm.p2.dropPct);
    } else {
      dropPctCell.textContent = '—';
    }
    if (vm.isBestT2DropPct) {
      dropPctCell.classList.add('overlay-best');
      dropPctCell.setAttribute('data-testid', 'overlay-best-cell');
      dropPctCell.setAttribute('aria-label', 'Lavest T2 drop % i sammenligningen');
    } else if (vm.isWorstT2DropPct) {
      dropPctCell.classList.add('overlay-worst');
      dropPctCell.setAttribute('data-testid', 'overlay-worst-cell');
      dropPctCell.setAttribute('aria-label', 'Høyest T2 drop % i sammenligningen');
    }
    tr.appendChild(dropPctCell);

    appendCell(tr, vm.p2 ? vm.p2.verdict : '—');
    appendCell(tr, vm.p1 ? vm.p1.verdict : '—');
    appendCell(tr, formatAddedAt(vm.addedAtMs));

    const actCell = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-testid', 'overlay-remove-row');
    btn.dataset.entryId = vm.id;
    btn.textContent = 'Fjern';
    btn.setAttribute('aria-label', `Fjern ${vm.filename} fra sammenligning`);
    actCell.appendChild(btn);
    tr.appendChild(actCell);

    tbody.appendChild(tr);
  });
}

function composeOverlaySummary(
  count: number,
  comparison: ReturnType<typeof computeOverlayComparison>
): string {
  const noun = count === 1 ? 'fil' : 'filer';
  if (count === 0) return `0 ${noun} i sammenligning`;
  const parts = [`${count} ${noun} i sammenligning`];
  if (comparison.bestT2DropPctEntryId !== null) {
    const best = comparison.entries.find(
      (e) => e.id === comparison.bestT2DropPctEntryId
    );
    if (best?.p2 && best.p2.dropPct !== null) {
      parts.push(`best T2 drop %: ${best.p2.dropPct.toFixed(4)} (${best.filename})`);
    }
  }
  if (comparison.worstT2DropPctEntryId !== null) {
    const worst = comparison.entries.find(
      (e) => e.id === comparison.worstT2DropPctEntryId
    );
    if (worst?.p2 && worst.p2.dropPct !== null) {
      parts.push(`verst T2 drop %: ${worst.p2.dropPct.toFixed(4)} (${worst.filename})`);
    }
  }
  if (comparison.incomparableCount > 0) {
    parts.push(`${comparison.incomparableCount} uten T2`);
  }
  return parts.join(' · ');
}

function formatAddedAt(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderSessionSection(root: HTMLElement, state: AppState): void {
  setText(root, 'session-status', state.sessionStatus.message);

  if (state.sessionStatus.lastAutosaveAt) {
    const ts = new Date(state.sessionStatus.lastAutosaveAt);
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const ss = String(ts.getSeconds()).padStart(2, '0');
    setText(root, 'autosave-status', `Sist lagret kl ${hh}:${mm}:${ss}`);
  } else {
    setText(root, 'autosave-status', 'Aldri lagret');
  }

  // Dirty indicator: a small mark when state diverges from the persisted
  // baseline. Since `commit` autosaves synchronously after every state
  // change, in steady-state we render "Synkronisert"; on storage failure or
  // before any save we render "Ulagret".
  let dirtyText = '—';
  switch (state.sessionStatus.kind) {
    case 'saved':
    case 'restored':
    case 'imported':
      dirtyText = 'Synkronisert';
      break;
    case 'restored_needs_file':
      dirtyText = 'Velg fil for å fortsette';
      break;
    case 'cleared':
      dirtyText = 'Ny test — ingen data';
      break;
    case 'unavailable':
      dirtyText = 'Autosave deaktivert';
      break;
    case 'error':
      dirtyText = 'Lagring feilet';
      break;
    case 'idle':
      dirtyText = state.sessionStatus.lastAutosaveAt ? 'Synkronisert' : 'Ulagret';
      break;
  }
  setText(root, 'session-dirty-indicator', dirtyText);

  const sourceSummary = composeSessionSourceSummary(state);
  setText(root, 'session-source-summary', sourceSummary);
}

function composeSessionSourceSummary(state: AppState): string {
  const parts: string[] = [];
  parts.push(state.sourceMode === 'manual' ? 'Manuell' : 'Fil');
  if (state.selectedFileName) parts.push(state.selectedFileName);
  if (state.parseResult) {
    parts.push(`${state.parseResult.meta.parsedRows} rader`);
  } else if (state.sourceMode === 'manual' && state.manualRows.length > 0) {
    parts.push(`${state.manualRows.length} manuelle rader (urørt)`);
  } else {
    parts.push('ingen data');
  }
  return parts.join(' · ');
}

function renderManualSection(root: HTMLElement, state: AppState): void {
  // Sync source-mode radios with state
  const radios = root.querySelectorAll<HTMLInputElement>(
    '[data-testid="data-source-mode"] input[type="radio"]'
  );
  radios.forEach((r) => {
    r.checked = r.value === state.sourceMode;
  });

  setText(root, 'manual-row-count', String(state.manualRows.length));
  setText(root, 'manual-validation-errors', composeManualValidationSummary(state));

  // Render table body via DOM API (avoids innerHTML on user-controlled cells).
  const table = root.querySelector<HTMLTableElement>('[data-testid="manual-table"]');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  state.manualRows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    appendCell(tr, String(index + 1));
    appendCell(tr, row.dateText || '—');
    appendCell(tr, row.timeText || '—');
    appendCell(tr, row.p1Text || '—');
    appendCell(tr, row.p2Text || '—');

    const actCell = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.testid = 'manual-delete-row';
    btn.dataset.rowId = row.id;
    btn.textContent = 'Slett';
    btn.setAttribute('aria-label', `Slett rad ${index + 1}`);
    actCell.appendChild(btn);
    tr.appendChild(actCell);

    tbody.appendChild(tr);
  });
}

function appendCell(tr: HTMLTableRowElement, text: string): void {
  const td = document.createElement('td');
  td.textContent = text;
  tr.appendChild(td);
}

function composeManualValidationSummary(state: AppState): string {
  if (state.manualRows.length === 0) {
    return 'Ingen rader registrert. Skriv inn én rad over, eller bruk «Lim inn fra paste».';
  }
  const v = state.manualValidation;
  if (!v) return 'Ikke validert.';

  if (v.errors.length === 0 && v.warnings.length === 0) {
    return `${v.validRowCount} av ${v.totalRowCount} rader gyldige. Klart for "Bruk manuelle rader".`;
  }
  const parts: string[] = [];
  if (v.errors.length > 0) {
    parts.push(`${v.errors.length} feil`);
  }
  if (v.warnings.length > 0) {
    parts.push(`${v.warnings.length} advarsler`);
  }
  parts.push(`${v.validRowCount} av ${v.totalRowCount} rader gyldige`);
  // Surface first concrete issue so the operator knows where to look.
  const firstIssue = v.errors[0] ?? v.warnings[0];
  if (firstIssue) parts.push(`Først: ${firstIssue.message}`);
  return parts.join(' · ');
}

function renderReportSection(root: HTMLElement, state: AppState): void {
  // Sync metadata inputs (don't trample on a field the user is currently editing).
  syncMetadataInputs(root, state);

  // Preview / status fields. The export gate is intentionally narrow:
  // as long as there is trykktest-data we let the operator export. Missing
  // metadata is surfaced as an advisory in the status text, never as a
  // disabled button — operators in the field must always be able to get
  // a rapport out.
  const hasData =
    state.parseResult !== null &&
    state.parseResult.rows.length > 0 &&
    state.baselineDrop !== null &&
    state.holdResult !== null;
  setText(root, 'report-preview-status', composeReportPreviewStatus(state, hasData));
  setText(root, 'report-result-status', state.holdResult?.status ?? '—');
  setText(root, 'report-selected-period', resolvePeriodSummary(state));
  setText(
    root,
    'report-channel',
    state.parseResult ? state.selectedChannel.toUpperCase() : '—'
  );
  setText(root, 'report-drop-summary', composeDropSummary(state));

  // Toggle export buttons — enabled whenever data exists, regardless of
  // metadata. Missing metadata only triggers the advisory message above.
  const csvBtn = root.querySelector<HTMLButtonElement>('[data-testid="export-csv-button"]');
  const pdfBtn = root.querySelector<HTMLButtonElement>('[data-testid="export-pdf-button"]');
  if (csvBtn) csvBtn.disabled = !hasData;
  if (pdfBtn) pdfBtn.disabled = !hasData;

  // Export status message
  const exp = state.exportStatus;
  setText(root, 'export-status', exp.message || (exp.kind === 'idle' ? 'Ingen eksport ennå' : ''));
  const statusEl = root.querySelector<HTMLElement>('[data-testid="export-status"]');
  if (statusEl) {
    statusEl.classList.remove('export-success', 'export-error', 'export-idle');
    if (exp.kind === 'success') statusEl.classList.add('export-success');
    else if (exp.kind === 'error') statusEl.classList.add('export-error');
    else statusEl.classList.add('export-idle');
  }
}

function syncMetadataInputs(root: HTMLElement, state: AppState): void {
  const map: Array<[string, keyof AppState['reportMetadata']]> = [
    ['report-customer-input', 'customerName'],
    ['report-project-input', 'projectNumber'],
    ['report-location-input', 'location'],
    ['report-test-date-input', 'testDate'],
    ['report-ihpu-serial-input', 'ihpuSerial'],
    ['report-rov-system-input', 'rovSystem'],
    ['report-operator-input', 'operatorName'],
    ['report-comment-input', 'comment']
  ];
  for (const [testId, key] of map) {
    const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-testid="${testId}"]`
    );
    if (!el) continue;
    const desired = state.reportMetadata[key];
    if (el.value !== desired && document.activeElement !== el) {
      el.value = desired;
    }
  }
}

/**
 * Advisory status text for the report preview area.
 *
 * Decision: never block export when data exists. The status is purely
 * informational so the operator knows what to expect in the artifact:
 *  - no data: a clear "missing data" message + buttons disabled
 *  - data + UNKNOWN verdict: tell the operator the result is UNKNOWN so
 *    they don't ship a misleading "PASS" assumption
 *  - data + missing metadata: warn that the customer fields are still
 *    blank (recommended but not required)
 *  - everything: the original "Klar for eksport"
 *
 * Recommended metadata fields chosen by the operator (not enforced):
 * customerName, projectNumber, location, testDate, operatorName,
 * ihpuSerial, rovSystem.
 */
function composeReportPreviewStatus(state: AppState, hasData: boolean): string {
  if (!hasData) {
    return 'Mangler trykktest-data — last opp fil eller registrer manuelt.';
  }
  const status = state.holdResult?.status;
  if (status === 'UNKNOWN') {
    return 'Klar for eksport (resultat: UNKNOWN — sjekk meldinger nederst).';
  }
  if (!state.reportMetadata.customerName.trim()) {
    return 'Klar — kundenavn anbefalt før eksport.';
  }
  return 'Klar for eksport.';
}

function composeDropSummary(state: AppState): string {
  const drop = state.baselineDrop;
  if (!drop || drop.dropBar === null || drop.dropPct === null) return '—';
  const dropBar = drop.dropBar.toFixed(3);
  const dropPct = drop.dropPct.toFixed(4);
  return `${dropBar} bar (${dropPct} %)`;
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

function setHoldNarrativeClass(root: HTMLElement, status: string | null): void {
  const el = root.querySelector<HTMLElement>('[data-testid="hold-narrative"]');
  if (!el) return;
  el.classList.remove('hold-narrative-pass', 'hold-narrative-fail', 'hold-narrative-unknown');
  if (status === 'PASS') el.classList.add('hold-narrative-pass');
  else if (status === 'FAIL') el.classList.add('hold-narrative-fail');
  else el.classList.add('hold-narrative-unknown');
}

/**
 * Add a `needs-file` class to the upload section when the operator has
 * just restored a file-mode session and must reselect the source. Pure
 * styling hook — no behaviour change.
 */
function setUploadNeedsFileClass(root: HTMLElement, state: AppState): void {
  const el = root.querySelector<HTMLElement>('[data-testid="upload-section"]');
  if (!el) return;
  if (state.sessionStatus.kind === 'restored_needs_file') {
    el.classList.add('needs-file');
  } else {
    el.classList.remove('needs-file');
  }
}

/**
 * Build the hold-narrative sentence. Reads only existing `state.holdResult`
 * fields — no domain re-derivation. Returns an empty-state hint when there
 * is no evaluation yet (no parser data, missing criteria, …).
 */
function composeHoldNarrative(state: AppState): string {
  const hold = state.holdResult;
  if (!hold) {
    if (!state.parseResult || state.parseResult.rows.length === 0) {
      return 'Ingen evaluering ennå — last data og sett kriterier.';
    }
    return 'Ingen evaluering ennå — sett maxDropPct.';
  }

  const used = hold.drop.dropPct;
  const allowed = state.maxDropPct;

  if (hold.status === 'PASS') {
    if (used === null || !Number.isFinite(used)) {
      return `PASS — trykkfall under maks tillatt ${fmtPercentInline(allowed)}.`;
    }
    if (used < 0) {
      // Negative drop = pressure rose during the period; auto-PASS.
      return `PASS — trykket økte over perioden (${fmtPercentInline(used)}). Hold-kriterium ${fmtPercentInline(allowed)} er ikke i fare.`;
    }
    const margin = allowed - used;
    return `PASS — trykkfall ${fmtPercentInline(used)} er under maks tillatt ${fmtPercentInline(allowed)} (margin ${fmtPercentInline(margin)}).`;
  }

  if (hold.status === 'FAIL') {
    if (used === null || !Number.isFinite(used)) {
      return `FAIL — trykkfall overstiger maks tillatt ${fmtPercentInline(allowed)}.`;
    }
    const overshoot = used - allowed;
    return `FAIL — trykkfall ${fmtPercentInline(used)} overstiger maks tillatt ${fmtPercentInline(allowed)} (overskudd ${fmtPercentInline(overshoot)}).`;
  }

  // UNKNOWN — surface the most informative reason from holdResult.
  return composeUnknownReason(state);
}

function composeUnknownReason(state: AppState): string {
  const hold = state.holdResult;
  // Pull the first error/warning code we recognise. Fallback to a generic.
  const issues = [...(hold?.errors ?? []), ...(hold?.warnings ?? [])];
  for (const issue of issues) {
    switch (issue.code) {
      case 'MISSING_CRITERIA':
        return 'UNKNOWN — mangler maxDropPct. Sett kriteriet i Analyse-kontroller.';
      case 'NO_VALID_ROWS':
        return 'UNKNOWN — ingen gyldige rader i valgt periode.';
      case 'INSUFFICIENT_POINTS':
        return 'UNKNOWN — trenger minst 2 målepunkter for å beregne trykkfall.';
      case 'ZERO_DURATION':
        return 'UNKNOWN — perioden har 0 varighet (start- og sluttidspunkt er like).';
      case 'INVALID_REFERENCE':
        return 'UNKNOWN — referansetrykket er 0. Velg annet target eller la feltet stå tomt.';
      case 'EMPTY_RANGE':
        return 'UNKNOWN — ingen rader faller innenfor valgt periode. Juster Fra/Til.';
      case 'CHANNEL_NOT_PRESENT':
        return `UNKNOWN — kanal ${state.selectedChannel.toUpperCase()} mangler i datasettet. Bytt kanal.`;
    }
  }
  return 'UNKNOWN — kan ikke evaluere. Sjekk data og kriterier.';
}

function fmtPercentInline(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(2) + ' %';
}

/**
 * Build the "hele logg" summary line: time range + total duration.
 * When no parser data, returns an empty-state hint.
 */
function resolveFullLogSummary(state: AppState): string {
  const pr = state.parseResult;
  if (!pr || pr.rows.length === 0) return '—';
  const first = pr.rows[0]!.timeText || pr.rows[0]!.localIso.slice(11);
  const last =
    pr.rows[pr.rows.length - 1]!.timeText ??
    pr.rows[pr.rows.length - 1]!.localIso.slice(11);
  const dur = pr.meta.durationMinutes;
  const durStr = dur !== null && Number.isFinite(dur) ? ` (${dur.toFixed(1)} min)` : '';
  return `${first} → ${last}${durStr}`;
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
  return 'Venter på data — last opp en logg eller bruk manuelle rader.';
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

  // Append "(D.D min, P % av loggen)" when we have both the selected
  // duration and the full log duration to compute a percentage from.
  // Pure read of existing analysis fields — no recomputation here.
  const selectedDuration = state.baselineDrop?.durationMinutes ?? null;
  const fullDuration = pr?.meta.durationMinutes ?? null;
  let suffix = '';
  if (selectedDuration !== null && Number.isFinite(selectedDuration)) {
    suffix = ` (${selectedDuration.toFixed(1)} min`;
    if (fullDuration !== null && Number.isFinite(fullDuration) && fullDuration > 0) {
      const pct = (selectedDuration / fullDuration) * 100;
      suffix += `, ${pct.toFixed(0)} % av loggen`;
    }
    suffix += ')';
  }
  return `${fromText} → ${toText}${suffix}`;
}

/**
 * Sync the channel select, max-drop input, and target-pressure input from
 * state. Required after a restore (state changes but the input DOM was
 * initialised at mount time and only kept in sync via change events).
 */
function syncControlInputs(root: HTMLElement, state: AppState): void {
  const channelSelect = root.querySelector<HTMLSelectElement>('[data-testid="channel-select"]');
  if (channelSelect && document.activeElement !== channelSelect) {
    if (channelSelect.value !== state.selectedChannel) {
      channelSelect.value = state.selectedChannel;
    }
  }

  const maxDropInput = root.querySelector<HTMLInputElement>('[data-testid="max-drop-input"]');
  if (maxDropInput && document.activeElement !== maxDropInput) {
    const desired = String(state.maxDropPct);
    if (maxDropInput.value !== desired) maxDropInput.value = desired;
  }

  const targetInput = root.querySelector<HTMLInputElement>('[data-testid="target-pressure-input"]');
  if (targetInput && document.activeElement !== targetInput) {
    const desired = state.targetPressure === null ? '' : String(state.targetPressure);
    if (targetInput.value !== desired) targetInput.value = desired;
  }
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
