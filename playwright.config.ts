import { defineConfig, devices } from '@playwright/test';

/**
 * `PLAYWRIGHT_CHROMIUM_PATH` lets a CI image or sandbox point the tests at a
 * Chromium it already has, instead of downloading another copy. Unset, the
 * tests use whatever Playwright installed for itself.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
        env: {
          // A short budget keeps the suite quick. The sweep still reports
          // honest partial completion, which is what the tests check.
          SCAN_BUDGET_MS: '25000',
          SCAN_USERNAME_CONCURRENCY: '32',
        },
      },
});
