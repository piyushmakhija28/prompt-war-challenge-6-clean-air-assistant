/**
 * @fileoverview Playwright configuration. Starts the local server and runs the scenario
 * suite on a desktop and a mobile viewport. All third-party hosts are mocked by the specs.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',
    trace: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ }
  ],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/index.html`,
    env: { PORT: String(PORT), NO_OPEN: '1' },
    reuseExistingServer: false
  }
});
