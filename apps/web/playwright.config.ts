import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3100;
const MAGIC_LINK_FILE = join(tmpdir(), 'restomatch-magic-link.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    locale: 'he-IL',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --turbopack -p ${PORT}`,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test',
      AUTH_SECRET: 'dev-test-secret-32-characters-long!!',
      AUTH_URL: `http://localhost:${PORT}`,
      MAGIC_LINK_FILE,
      NODE_ENV: 'development',
      // resolveWebDbUrl() is fail-closed: without DATABASE_URL_APP the owner DB is
      // only allowed under NODE_ENV=test or this explicit dev/e2e opt-in.
      ALLOW_OWNER_DB: '1',
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

export { MAGIC_LINK_FILE };
