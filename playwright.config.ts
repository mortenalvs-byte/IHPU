import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /electron\.spec\.ts$/,
  outputDir: 'test-results',
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0
});
