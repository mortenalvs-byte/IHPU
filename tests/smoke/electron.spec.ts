import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Electron app: bootstrap shell, fixture upload, chart period selection', async () => {
  const appRoot = process.cwd();
  const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
  const fixturePath = path.join(appRoot, 'test-data', 'Dekk test Seal T.2');
  const screenshotDir = path.join(appRoot, 'test-results');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const electronApp = await electron.launch({
    args: [mainPath],
    cwd: appRoot,
    env: {
      ...process.env,
      IHPU_FORCE_PROD: '1',
      VITE_DEV_SERVER_URL: ''
    }
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // ----- Initial shell -----
    await expect(window).toHaveTitle(/IHPU TrykkAnalyse/);
    await expect(window.getByTestId('app-title')).toContainText('IHPU TrykkAnalyse');
    await expect(window.getByTestId('app-ready')).toContainText('Bootstrap OK');
    await expect(window.getByTestId('file-status')).toContainText('Ingen data lastet');
    await expect(window.getByTestId('file-input')).toBeEnabled();
    await expect(window.getByTestId('chart-status')).toContainText('Venter på data');

    // ----- Upload canonical fixture -----
    await window.getByTestId('file-input').setInputFiles(fixturePath);

    // Parse summary
    await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
    await expect(window.getByTestId('parse-error-count')).toHaveText('0');
    await expect(window.getByTestId('parse-warning-count')).toHaveText('0');
    await expect(window.getByTestId('duration-minutes')).toContainText('69.4');

    // Chart mounted
    await expect(window.getByTestId('chart-status')).toContainText('Klar');
    await expect(window.getByTestId('pressure-chart')).toBeVisible();

    // Default full-range pressure summary (reference: start)
    await expect(window.getByTestId('pressure-start')).toContainText('314.387');
    await expect(window.getByTestId('pressure-end')).toContainText('299.279');
    await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
    await expect(window.getByTestId('pressure-drop-pct-start')).toContainText('4.8055');
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');
    await expect(window.getByTestId('selected-period-summary')).toContainText('Hele loggen');

    // ----- Manual period that equals full range -----
    await window.getByTestId('period-from-input').fill('13:10:37');
    await window.getByTestId('period-to-input').fill('14:20:01');

    await expect(window.getByTestId('selected-period-summary')).toContainText('13:10:37');
    await expect(window.getByTestId('selected-period-summary')).toContainText('14:20:01');
    await expect(window.getByTestId('selected-period-duration')).toContainText('69.4');
    await expect(window.getByTestId('selected-period-start-pressure')).toContainText('314.387');
    await expect(window.getByTestId('selected-period-end-pressure')).toContainText('299.279');
    // Canonical metrics still match because the range equals the full data range
    await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
    await expect(window.getByTestId('pressure-drop-pct-start')).toContainText('4.8055');
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');

    // ----- Shorten period to 13:10:37 → 13:20:00 -----
    await window.getByTestId('period-to-input').fill('13:20:00');

    // Duration drops from 69.4 to ~9.4 (9 min 23 sec)
    const shortDuration = await window.getByTestId('selected-period-duration').textContent();
    expect(shortDuration).toMatch(/\b9\.[0-9]\s*min\b/);

    // Pressure-drop-bar must change from the full-range 15.108
    const shortDropBar = await window.getByTestId('pressure-drop-bar').textContent();
    expect(shortDropBar).not.toContain('15.108');

    // Hold status still renders (PASS, FAIL, or UNKNOWN — never blank)
    const shortHold = await window.getByTestId('hold-status').textContent();
    expect(shortHold).toMatch(/^(PASS|FAIL|UNKNOWN)$/);

    // ----- Reset period -----
    await window.getByTestId('reset-period-selection').click();

    await expect(window.getByTestId('selected-period-summary')).toContainText('Hele loggen');
    await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
    await expect(window.getByTestId('pressure-drop-pct-start')).toContainText('4.8055');
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');
    await expect(window.getByTestId('period-from-input')).toHaveValue('');
    await expect(window.getByTestId('period-to-input')).toHaveValue('');

    // Reset zoom button exists and is clickable
    await window.getByTestId('reset-chart-zoom').click();

    await window.screenshot({
      path: path.join(screenshotDir, 'electron-pressure-chart-period-selection.png'),
      fullPage: true
    });
  } finally {
    await electronApp.close();
  }
});
