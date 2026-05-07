import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Electron app opens bootstrap window', async () => {
  const appRoot = process.cwd();
  const mainPath = path.join(appRoot, 'dist-electron', 'main.js');
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

    await expect(window).toHaveTitle(/IHPU TrykkAnalyse/);
    await expect(window.getByText('Bootstrap OK')).toBeVisible({ timeout: 10000 });
    await expect(window.getByText('Ingen data lastet')).toBeVisible();

    await window.screenshot({
      path: path.join(screenshotDir, 'electron-bootstrap.png'),
      fullPage: true
    });
  } finally {
    await electronApp.close();
  }
});
