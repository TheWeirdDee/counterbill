import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://counterbill:counterbill@127.0.0.1:54329/counterbill_test';

/**
 * End-to-end tests run a dedicated stack (Next.js + worker) on port 3100 against the test database.
 * The model is the labelled deterministic test runner, so these prove the product flow, not model quality.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 150_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx concurrently -k -n web,worker "npx next dev -p ${PORT}" "npx tsx workers/supervisor.ts"`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: DB,
      COUNTERBILL_INFERENCE: 'test',
      PUBLIC_APP_URL: `http://localhost:${PORT}`,
      SESSION_SECRET: 'e2e-session-secret',
      NEXT_DIST_DIR: '.next-e2e',
      DEMO_RUNS_PER_IP_PER_HOUR: '500',
    },
  },
});
