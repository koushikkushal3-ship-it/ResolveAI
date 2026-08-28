import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Runs against an already-running stack (backend on :5000, frontend on :5173)
 * rather than spawning one. The backend needs a seeded Supabase project and
 * real provider keys, so a webServer block that boots it here would either
 * duplicate that setup or fail confusingly.
 *
 * Workers are forced to 1: these specs share one database, and a simulator run
 * in one worker would move the numbers another worker is asserting on.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
