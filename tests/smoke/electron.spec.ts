import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Electron app: bootstrap shell + canonical fixture upload flow', async () => {
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

    // File input must be enabled (not the disabled placeholder from bootstrap PR)
    await expect(window.getByTestId('file-input')).toBeEnabled();

    // ----- Upload canonical fixture -----
    await window.getByTestId('file-input').setInputFiles(fixturePath);

    // Parse summary
    await expect(window.getByTestId('parsed-row-count')).toHaveText('461');
    await expect(window.getByTestId('parse-error-count')).toHaveText('0');
    await expect(window.getByTestId('parse-warning-count')).toHaveText('0');
    await expect(window.getByTestId('duration-minutes')).toContainText('69.4');
    await expect(window.getByTestId('file-name')).toContainText('Dekk test Seal T.2');
    await expect(window.getByTestId('first-timestamp')).toContainText('2026-02-21T13:10:37');
    await expect(window.getByTestId('last-timestamp')).toContainText('2026-02-21T14:20:01');
    await expect(window.getByTestId('channel-p1-present')).toContainText('tilstede');
    await expect(window.getByTestId('channel-p2-present')).toContainText('tilstede');

    // Pressure summary (default channel = p2, no target → reference is start)
    await expect(window.getByTestId('pressure-start')).toContainText('314.387');
    await expect(window.getByTestId('pressure-end')).toContainText('299.279');
    await expect(window.getByTestId('pressure-drop-bar')).toContainText('15.108');
    await expect(window.getByTestId('pressure-drop-pct-start')).toContainText('4.8055');
    await expect(window.getByTestId('pressure-drop-pct-target')).toContainText('—');
    await expect(window.getByTestId('pressure-rate-minute')).toContainText('0.2177');
    await expect(window.getByTestId('pressure-rate-hour')).toContainText('13.0616');
    await expect(window.getByTestId('pressure-increased')).toHaveText('Nei');

    // Hold status with default maxDropPct = 5
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');
    await expect(window.getByTestId('hold-used-drop-pct')).toContainText('4.8055');
    await expect(window.getByTestId('hold-allowed-drop-pct')).toContainText('5.0000');
    await expect(window.getByTestId('hold-margin-pct')).toContainText('0.1945');

    // ----- Tighten threshold to 4 → expect FAIL -----
    await window.getByTestId('max-drop-input').fill('4');
    await expect(window.getByTestId('hold-status')).toHaveText('FAIL');
    await expect(window.getByTestId('hold-allowed-drop-pct')).toContainText('4.0000');

    // ----- Restore threshold + add target pressure 315 → expect PASS + dropPctOfTarget -----
    await window.getByTestId('max-drop-input').fill('5');
    await window.getByTestId('target-pressure-input').fill('315');

    await expect(window.getByTestId('pressure-drop-pct-target')).toContainText('4.7962');
    await expect(window.getByTestId('hold-status')).toHaveText('PASS');
    // Hold uses target reference when target is supplied
    await expect(window.getByTestId('hold-used-drop-pct')).toContainText('4.7962');

    await window.screenshot({
      path: path.join(screenshotDir, 'electron-file-upload-summary.png'),
      fullPage: true
    });
  } finally {
    await electronApp.close();
  }
});
