import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_AUTH_ENC_KEY, E2E_DATABASE_URL, MAGIC_LINK_FILE, PORT } from './e2e/env';

/**
 * Browser suite (apps/web/e2e). Runs against `next dev` on its OWN database
 * (restomatch_e2e — never the vitest DB, which the unit suites truncate):
 *
 *   pnpm --filter @restomatch/web test:e2e          # full suite
 *   pnpm --filter @restomatch/web test:e2e:smoke    # smoke only (every page, he + en)
 *
 * Before anything starts, e2e/prepare-db.ts creates/migrates/RLS-provisions the
 * e2e DB and seeds the demo tenant (E2E_SKIP_SEED=1 reuses an already-seeded
 * DB). The web server then connects as the RLS app role, like production.
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH (preinstalled in the cloud
 * container — never `playwright install` there).
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
/** The cloud container ships one Chromium that may not match this @playwright/test
 *  revision (never `playwright install` there); CI installs the matching one. */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  return !process.env.CI && existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;
}

// The config module is evaluated by the runner AND by every worker; the env
// marker makes the (destructive, ~15s) DB prep run exactly once per invocation.
if (!process.env.E2E_APP_URL) {
  const out = execFileSync(
    'pnpm',
    ['--filter', '@restomatch/db', 'exec', 'tsx', join(dirname(fileURLToPath(import.meta.url)), 'e2e', 'prepare-db.ts')],
    { env: { ...process.env, E2E_DATABASE_URL }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const appUrl = /E2E_APP_URL=(\S+)/.exec(out)?.[1];
  if (!appUrl) throw new Error('[playwright] e2e/prepare-db.ts did not report E2E_APP_URL');
  process.env.E2E_APP_URL = appUrl;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // next dev compiles each route on first hit — give navigations room.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'he-IL',
    navigationTimeout: 60_000,
  },
  projects: [
    // Signs the demo owner in once (e2e/auth.setup.ts → test-results/.auth).
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { launchOptions: { executablePath: chromiumPath() } } },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: chromiumPath() },
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm exec next dev --turbopack -p ${PORT}`,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      DATABASE_URL_APP: process.env.E2E_APP_URL,
      AUTH_SECRET: 'e2e-only-secret-32-characters-long!!',
      AUTH_ENC_KEY: E2E_AUTH_ENC_KEY,
      AUTH_URL: `http://localhost:${PORT}`,
      APP_URL: `http://localhost:${PORT}`,
      MAGIC_LINK_FILE,
      // The seed does not flag anyone is_platform_admin; this lets /admin render.
      PLATFORM_ADMIN_EMAILS: 'owner@kfar-hazeitim.test',
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      // The receiving specs play the OCR worker and the matcher themselves (they
      // write invoice_lines / match_runs at a moment they choose): the in-process
      // after() kick must not run the dev OCR stub / engine underneath them.
      JOB_KICK: 'off',
      // CI exports a placeholder NEXT_PUBLIC_SUPABASE_URL (inherited here) but no
      // service-role key, so scans land in dev local storage
      // (http://localhost:PORT/scans/<id>/file); without this the SSRF pin derives
      // the placeholder's /storage/v1/object/sign/ prefix and registerInvoice 400s.
      INVOICE_SCAN_URL_PREFIX: `http://localhost:${PORT}/scans/`,
    },
    url: `http://localhost:${PORT}/api/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
