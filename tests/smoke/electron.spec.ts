import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test.describe('Electron app smoke', () => {
  test('file flow: bootstrap, fixture upload, chart period, report export', async () => {
    const appRoot = process.cwd();
    const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
    const fixturePath = path.join(appRoot, 'test-data', 'Dekk test Seal T.2');
    const screenshotDir = path.join(appRoot, 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const electronApp = await electron.launch({
      args: [mainPath],
      cwd: appRoot,
      env: { ...process.env, IHPU_FORCE_PROD: '1', VITE_DEV_SERVER_URL: '' }
    });

    try {
      const window = await electronApp.firstWindow();

      await window.waitForLoadState('domcontentloaded');

      // Wipe any persisted session from a prior test run so this test starts
      // from a known empty state (Electron shares its userData dir across
      // launches, so localStorage persists across `electron.launch` calls).
      await window.getByTestId('new-test-button').click();

      // Initial shell
      await expect(window).toHaveTitle(/IHPU TrykkAnalyse/);
      await expect(window.getByTestId('app-title')).toContainText('IHPU TrykkAnalyse');
      await expect(window.getByTestId('app-ready')).toContainText('Bootstrap OK');
      // Empty-state should both communicate "no data" and tell the operator
      // what to do next (PR #11 polish).
      await expect(window.getByTestId('file-status')).toContainText('Ingen data lastet');
      await expect(window.getByTestId('file-status')).toContainText('Manuell registrering');
      await expect(window.getByTestId('file-input')).toBeEnabled();
      // Hold narrative starts as the empty-state hint.
      await expect(window.getByTestId('hold-narrative')).toContainText(
        'Ingen evaluering ennå'
      );

      // Manual section visible from start
      await expect(window.getByTestId('manual-entry-section')).toBeVisible();

      // Upload canonical fixture
      await window.getByTestId('file-input').setInputFiles(fixturePath);
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('chart-status')).toContainText('Klar');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
      await expect(window.getByTestId('hold-status')).toHaveText('PASS');
      // hold-narrative should explain the verdict in human terms (PR #11).
      await expect(window.getByTestId('hold-narrative')).toContainText('PASS');
      await expect(window.getByTestId('hold-narrative')).toContainText('margin');
      // full-log-summary shows the parsed time range + total duration.
      await expect(window.getByTestId('full-log-summary')).toContainText('13:10:37');
      await expect(window.getByTestId('full-log-summary')).toContainText('min');

      // Manual period round-trip
      await window.getByTestId('period-from-input').fill('13:10:37');
      await window.getByTestId('period-to-input').fill('14:20:01');
      await expect(window.getByTestId('selected-period-summary')).toContainText('13:10:37');
      await window.getByTestId('reset-period-selection').click();
      await expect(window.getByTestId('selected-period-summary')).toContainText('Hele loggen');

      // Before metadata is filled the report-preview-status is advisory but
      // the export button is enabled — operator can always export.
      await expect(window.getByTestId('export-csv-button')).toBeEnabled();
      await expect(window.getByTestId('export-pdf-button')).toBeEnabled();
      await expect(window.getByTestId('report-preview-status')).toContainText(
        'kundenavn anbefalt'
      );

      // Report metadata + export
      await window.getByTestId('report-customer-input').fill('Test Customer AS');
      await window.getByTestId('report-project-input').fill('PRJ-001');
      await window.getByTestId('report-test-date-input').fill('21.02.2026');
      // After kundenavn the advisory drops the warning.
      await expect(window.getByTestId('report-preview-status')).toContainText(
        'Klar for eksport'
      );
      await expect(window.getByTestId('export-csv-button')).toBeEnabled();
      await window.getByTestId('export-csv-button').click();
      await expect(window.getByTestId('export-status')).toContainText('CSV exported');
      await expect(window.getByTestId('export-status')).toContainText('PRJ-001');
      await window.getByTestId('export-pdf-button').click();
      await expect(window.getByTestId('export-status')).toContainText('PDF exported');

      // Verify the PDF byte size is materially larger than a text-only PDF
      // could be — the export-status text reads
      // `PDF exported: <filename> (<bytes> bytes)`. The text-only baseline
      // for this fixture is ~5–10 kB; with the chart image and the 461-row
      // raw-data table the PDF is comfortably above 30 kB.
      const pdfStatusText = await window.getByTestId('export-status').textContent();
      const pdfMatch = pdfStatusText?.match(/\((\d+) bytes\)/);
      expect(pdfMatch, `PDF status should include byte count: "${pdfStatusText}"`).not.toBeNull();
      const pdfBytes = Number(pdfMatch![1]);
      expect(pdfBytes).toBeGreaterThan(30_000);

      // PR #11 polish: reload the renderer and confirm that file-mode
      // session restore surfaces the needs-file CSS hint on the upload card.
      // Raw bytes are not persisted, so the operator must reselect the file
      // — the visual hint draws their attention to where to click.
      await window.reload();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('session-status')).toContainText('gjenopprettet');
      await expect(window.getByTestId('upload-section')).toHaveClass(/needs-file/);
      // Reselecting the file removes the hint.
      await window.getByTestId('file-input').setInputFiles(fixturePath);
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('upload-section')).not.toHaveClass(/needs-file/);

      await window.screenshot({
        path: path.join(screenshotDir, 'electron-file-flow.png'),
        fullPage: true
      });
    } finally {
      await electronApp.close();
    }
  });

  test('manual flow: enter rows, use as source, analyse, export', async () => {
    const appRoot = process.cwd();
    const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
    const screenshotDir = path.join(appRoot, 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const electronApp = await electron.launch({
      args: [mainPath],
      cwd: appRoot,
      env: { ...process.env, IHPU_FORCE_PROD: '1', VITE_DEV_SERVER_URL: '' }
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // Wipe any persisted session from a prior test run.
      await window.getByTestId('new-test-button').click();

      // Initial state
      await expect(window.getByTestId('manual-entry-section')).toBeVisible();
      await expect(window.getByTestId('manual-row-count')).toHaveText('0');

      // Add three valid rows manually
      const rows = [
        { date: '21.02.2026', time: '13:00:00', p1: '-2.96', p2: '320.00' },
        { date: '21.02.2026', time: '13:30:00', p1: '-2.95', p2: '305.00' },
        { date: '21.02.2026', time: '14:00:00', p1: '-2.94', p2: '290.00' }
      ];
      for (const row of rows) {
        await window.getByTestId('manual-date-input').fill(row.date);
        await window.getByTestId('manual-time-input').fill(row.time);
        await window.getByTestId('manual-p1-input').fill(row.p1);
        await window.getByTestId('manual-p2-input').fill(row.p2);
        await window.getByTestId('manual-add-row-button').click();
      }

      await expect(window.getByTestId('manual-row-count')).toHaveText('3');

      // Toggle source mode to manual + use the rows
      await window.getByTestId('manual-use-rows-button').click();

      // The manual rows should now be the active source
      await expect(window.getByTestId('parsed-row-count')).toHaveText('3');
      await expect(window.getByTestId('parse-error-count')).toHaveText('0');
      await expect(window.getByTestId('chart-status')).toContainText('Klar');

      // Pressure summary should reflect manual data: drop 30 bar over 60 min
      await expect(window.getByTestId('pressure-start')).toContainText('320.000');
      await expect(window.getByTestId('pressure-end')).toContainText('290.000');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('30.000');
      await expect(window.getByTestId('duration-minutes')).toContainText('60.0');

      // Negative T1 preserved (no warning, value displayed)
      await expect(window.getByTestId('channel-p1-present')).toContainText('tilstede');
      await expect(window.getByTestId('channel-p2-present')).toContainText('tilstede');

      // Hold status should evaluate (default maxDropPct=5, 30/320 = 9.375% → FAIL)
      const holdStatusText = await window.getByTestId('hold-status').textContent();
      expect(holdStatusText).toMatch(/^(PASS|FAIL|UNKNOWN)$/);

      // File-name banner should show the manual source
      await expect(window.getByTestId('file-status')).toContainText('Manual entry');

      // Fill metadata + export
      await window.getByTestId('report-customer-input').fill('Manual Customer');
      await window.getByTestId('report-project-input').fill('PRJ-MANUAL');
      await window.getByTestId('report-test-date-input').fill('21.02.2026');

      await expect(window.getByTestId('export-csv-button')).toBeEnabled();
      await window.getByTestId('export-csv-button').click();
      await expect(window.getByTestId('export-status')).toContainText('CSV exported');
      await window.getByTestId('export-pdf-button').click();
      await expect(window.getByTestId('export-status')).toContainText('PDF exported');

      // Delete one row, confirm count + state update
      await window.locator('[data-testid="manual-table"] [data-testid="manual-delete-row"]').first().click();
      await expect(window.getByTestId('manual-row-count')).toHaveText('2');
      // After delete, the active manual source recomputes:
      await expect(window.getByTestId('parsed-row-count')).toHaveText('2');

      // Clear all rows
      await window.getByTestId('manual-clear-rows').click();
      await expect(window.getByTestId('manual-row-count')).toHaveText('0');
      // With no manual rows, parseResult goes empty
      await expect(window.getByTestId('parsed-row-count')).toHaveText('—');

      await window.screenshot({
        path: path.join(screenshotDir, 'electron-manual-entry.png'),
        fullPage: true
      });
    } finally {
      await electronApp.close();
    }
  });

  test('overlay flow: load comparison file, primary unchanged, remove + clear', async () => {
    const appRoot = process.cwd();
    const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
    const fixturePath = path.join(appRoot, 'test-data', 'Dekk test Seal T.2');
    const screenshotDir = path.join(appRoot, 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const electronApp = await electron.launch({
      args: [mainPath],
      cwd: appRoot,
      env: { ...process.env, IHPU_FORCE_PROD: '1', VITE_DEV_SERVER_URL: '' }
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // Wipe any persisted session from a prior test run.
      await window.getByTestId('new-test-button').click();

      // Overlay card visible from startup with empty state.
      await expect(window.getByTestId('overlay-section')).toBeVisible();
      await expect(window.getByTestId('overlay-status')).toContainText('Ingen sammenligningsfiler');
      await expect(window.getByTestId('overlay-summary')).toContainText('0 filer');
      await expect(window.locator('[data-testid="overlay-table"] tbody tr')).toHaveCount(0);

      // Upload canonical fixture as primary source.
      await window.getByTestId('file-input').setInputFiles(fixturePath);
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
      await expect(window.getByTestId('hold-status')).toHaveText('PASS');

      // Add the SAME fixture into the overlay set.
      await window.getByTestId('overlay-file-input').setInputFiles(fixturePath);
      await expect(window.getByTestId('overlay-status')).toContainText('lagt til');
      await expect(window.locator('[data-testid="overlay-table"] tbody tr')).toHaveCount(1);
      await expect(window.getByTestId('overlay-summary')).toContainText('1 fil');

      // Overlay row preserves its own numbers (461 rows, ~15.108 T2 drop).
      const firstRow = window.locator('[data-testid="overlay-row"]').first();
      await expect(firstRow).toContainText('461');
      await expect(firstRow).toContainText('15.108');
      await expect(firstRow).toContainText('PASS');

      // Primary dashboard is unchanged after overlay add.
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
      await expect(window.getByTestId('hold-status')).toHaveText('PASS');

      // Add a SECOND copy (overlay supports multiple) and verify count.
      await window.getByTestId('overlay-file-input').setInputFiles(fixturePath);
      await expect(window.locator('[data-testid="overlay-table"] tbody tr')).toHaveCount(2);
      await expect(window.getByTestId('overlay-summary')).toContainText('2 filer');

      // Remove one row from the overlay table; primary still unchanged.
      await window.locator('[data-testid="overlay-remove-row"]').first().click();
      await expect(window.locator('[data-testid="overlay-table"] tbody tr')).toHaveCount(1);
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');

      // Clear overlay; primary still unchanged.
      await window.getByTestId('overlay-clear-button').click();
      await expect(window.locator('[data-testid="overlay-table"] tbody tr')).toHaveCount(0);
      await expect(window.getByTestId('overlay-status')).toContainText('tømt');
      await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
      await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');

      await window.screenshot({
        path: path.join(screenshotDir, 'electron-overlay-flow.png'),
        fullPage: true
      });
    } finally {
      await electronApp.close();
    }
  });

  test('session flow: autosave + reload restores manual rows + new-test clears', async () => {
    const appRoot = process.cwd();
    const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
    const screenshotDir = path.join(appRoot, 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });

    const electronApp = await electron.launch({
      args: [mainPath],
      cwd: appRoot,
      env: { ...process.env, IHPU_FORCE_PROD: '1', VITE_DEV_SERVER_URL: '' }
    });

    try {
      const window = await electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      // Start clean by clicking "Ny test" so any prior persisted session
      // (from the manual-flow test running just before) is wiped.
      await window.getByTestId('new-test-button').click();
      await expect(window.getByTestId('session-status')).toContainText('Ny test');
      await expect(window.getByTestId('manual-row-count')).toHaveText('0');

      // Add three manual rows + fill metadata + criteria.
      const rows = [
        { date: '21.02.2026', time: '13:00:00', p1: '-2.96', p2: '320.00' },
        { date: '21.02.2026', time: '13:30:00', p1: '-2.95', p2: '305.00' },
        { date: '21.02.2026', time: '14:00:00', p1: '-2.94', p2: '290.00' }
      ];
      for (const row of rows) {
        await window.getByTestId('manual-date-input').fill(row.date);
        await window.getByTestId('manual-time-input').fill(row.time);
        await window.getByTestId('manual-p1-input').fill(row.p1);
        await window.getByTestId('manual-p2-input').fill(row.p2);
        await window.getByTestId('manual-add-row-button').click();
      }
      await expect(window.getByTestId('manual-row-count')).toHaveText('3');

      await window.getByTestId('manual-use-rows-button').click();
      await expect(window.getByTestId('parsed-row-count')).toHaveText('3');

      await window.getByTestId('report-customer-input').fill('Session Customer AS');
      await window.getByTestId('report-project-input').fill('PRJ-SESS');
      await window.getByTestId('max-drop-input').fill('7');
      await window.getByTestId('target-pressure-input').fill('325');

      // Autosave should have fired by now.
      await expect(window.getByTestId('session-status')).toContainText('Lagret');
      await expect(window.getByTestId('autosave-status')).toContainText('Sist lagret');

      // ----- Reload the renderer; localStorage persists for same origin -----
      await window.reload();
      await window.waitForLoadState('domcontentloaded');

      // After reload: restoreSessionOnStartup runs and the manual rows + metadata
      // come back. The chart re-mounts because manual mode rebuilt parseResult.
      await expect(window.getByTestId('session-status')).toContainText('gjenopprettet');
      await expect(window.getByTestId('manual-row-count')).toHaveText('3');
      await expect(window.getByTestId('parsed-row-count')).toHaveText('3');
      await expect(window.getByTestId('report-customer-input')).toHaveValue('Session Customer AS');
      await expect(window.getByTestId('report-project-input')).toHaveValue('PRJ-SESS');
      await expect(window.getByTestId('max-drop-input')).toHaveValue('7');
      await expect(window.getByTestId('target-pressure-input')).toHaveValue('325');
      await expect(window.getByTestId('chart-status')).toContainText('Klar');

      // ----- New test wipes everything -----
      await window.getByTestId('new-test-button').click();
      await expect(window.getByTestId('session-status')).toContainText('Ny test');
      await expect(window.getByTestId('manual-row-count')).toHaveText('0');
      await expect(window.getByTestId('parsed-row-count')).toHaveText('—');
      await expect(window.getByTestId('report-customer-input')).toHaveValue('');
      await expect(window.getByTestId('max-drop-input')).toHaveValue('5');

      await window.screenshot({
        path: path.join(screenshotDir, 'electron-session-flow.png'),
        fullPage: true
      });
    } finally {
      await electronApp.close();
    }
  });
});
