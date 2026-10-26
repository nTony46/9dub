import { defineConfig, devices } from '@playwright/test'

/**
 * Two servers:
 * - 5299 serves the app with local data switched OFF, so the flows in
 *   draft-flow.spec.ts and season.spec.ts always run on the deterministic fictional demo pool;
 * - 5298 serves the private real-data snapshot (if `npm run data:ingest` has
 *   been run). real-draft.spec.ts skips itself when no snapshot exists.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'demo',
      testMatch: ['draft-flow.spec.ts', 'season.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:5299' },
    },
    {
      name: 'real-data',
      testMatch: 'real-draft.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:5298' },
    },
  ],
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js --port 5299 --strictPort',
      url: 'http://localhost:5299',
      env: { NINEDUB_LOCAL_DATA: 'off', NINEDUB_SESSION_SAVE: 'off', NINEDUB_ESPN: 'off' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --port 5298 --strictPort',
      url: 'http://localhost:5298',
      env: { NINEDUB_SESSION_SAVE: 'off', NINEDUB_ESPN: 'off' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
