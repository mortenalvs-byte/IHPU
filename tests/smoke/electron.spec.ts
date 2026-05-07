import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Electron app: bootstrap, fixture upload, chart period, report export', async () => {
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

    // Export buttons disabled before any file
    await expect(window.getByTestId('export-csv-button')).toBeDisabled();
    await expect(window.getByTestId('export-pdf-button')).toBeDisabled();
    await expect(window.getByTestId('report-preview-status')).toContainText('Ingen data lastet');

    // ----- Upload canonical fixture -----
    await window.getByTestId('file-input').setInputFiles(fixturePath);

    // Parse summary
    await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
    await expect(window.getByTestId('parse-error-count')).toHaveText('0');
    await expect(window.getByTestId('chart-status')).toContainText('Klar');

    // Default full-range pressure summary
    await expect(window.getByTestId('pressure-start')).toContainText('314.387');
    await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');

    // Report fields populate from analysis
    await expect(window.getByTestId('report-preview-status')).toContainText('Klar for eksport');
    await expect(window.getByTestId('report-result-status')).toHaveText('PASS');
    await expect(window.getByTestId('report-channel')).toHaveText('P2');
    await expect(window.getByTestId('report-drop-summary')).toContainText('15.108');
    await expect(window.getByTestId('report-selected-period')).toContainText('Hele loggen');

    // ----- Manual period selection sanity -----
    await window.getByTestId('period-from-input').fill('13:10:37');
    await window.getByTestId('period-to-input').fill('14:20:01');
    await expect(window.getByTestId('selected-period-summary')).toContainText('13:10:37');
    await expect(window.getByTestId('selected-period-summary')).toContainText('14:20:01');
    await window.getByTestId('reset-period-selection').click();
    await expect(window.getByTestId('selected-period-summary')).toContainText('Hele loggen');

    // ----- Fill report metadata -----
    await window.getByTestId('report-customer-input').fill('Test Customer AS');
    await window.getByTestId('report-project-input').fill('PRJ-001');
    await window.getByTestId('report-location-input').fill('Stavanger');
    await window.getByTestId('report-test-date-input').fill('21.02.2026');
    await window.getByTestId('report-ihpu-serial-input').fill('IHPU-001');
    await window.getByTestId('report-rov-system-input').fill('C24');
    await window.getByTestId('report-operator-input').fill('Morten');
    await window.getByTestId('report-comment-input').fill('Smoke test report');

    // ----- Export buttons enabled, click them -----
    await expect(window.getByTestId('export-csv-button')).toBeEnabled();
    await expect(window.getByTestId('export-pdf-button')).toBeEnabled();

    // CSV export — assert success status updates. Per the report-export-foundation
    // contract, the smoke verifies the status string and no crash; deep CSV/PDF
    // content is covered by Vitest unit tests.
    await window.getByTestId('export-csv-button').click();
    await expect(window.getByTestId('export-status')).toContainText('CSV exported');
    await expect(window.getByTestId('export-status')).toContainText('PRJ-001');
    await expect(window.getByTestId('export-status')).toContainText('PASS');
    await expect(window.getByTestId('export-status')).toContainText('.csv');

    // PDF export
    await window.getByTestId('export-pdf-button').click();
    await expect(window.getByTestId('export-status')).toContainText('PDF exported');
    await expect(window.getByTestId('export-status')).toContainText('.pdf');

    await window.screenshot({
      path: path.join(screenshotDir, 'electron-report-export.png'),
      fullPage: true
    });
  } finally {
    await electronApp.close();
  }
});
