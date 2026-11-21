import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Pilot journey (docs/PILOT-QA.md) — a brand-new, EMPTY restaurant walked from first login
 * to a claims letter. Separate from playwright.config.ts (the shared suite): it starts no
 * server and seeds nothing.
 *
 *   PILOT_PROBE unset   Stage A — scripts/pilot-lab.sh serves a local production build and
 *                       passes PILOT_BASE_URL + PILOT_FACTS (lab ids, written by e2e/pilot/lab.ts).
 *   PILOT_PROBE=public  Stage B, unauthenticated subset — GETs only, no login.
 *   PILOT_PROBE=readonly Stage B — + one login per QA role (credentials from env, Rom's machine).
 *   PILOT_PROBE=write   Stage C — the journey on production's QA tenant (Rom only; guarded).
 *
 * One project: the office roles use a 1440 desktop context and the receiver a Pixel 7
 * context; the steps run in file order on one worker, so the journey's state flows step to step.
 */
// One id per run, set here (main process) so every worker sees the same value: Playwright
// restarts the worker after a failed step, and the journey's state must survive that.
process.env.PILOT_SUITE = '1'; // the specs skip themselves under the shared playwright.config.ts
process.env.PILOT_RUN_ID ??= new Date().toISOString().replace(/\D/g, '').slice(0, 14);

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const chromium = process.env.PW_CHROMIUM_PATH ?? (!process.env.CI && existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);
const probe = process.env.PILOT_PROBE ?? '';
if (!['', 'public', 'readonly', 'write'].includes(probe)) {
  throw new Error(`PILOT_PROBE must be public, readonly or write (got "${probe}")`);
}

export default defineConfig({
  testDir: '.',
  // Stage C (write) is the journey itself, behind the QA-tenant guard; public/readonly is the probe.
  testMatch: probe === 'public' || probe === 'readonly' ? /pilot-probe\.spec\.ts/ : /pilot-journey\.spec\.ts/,
  outputDir: '../../test-results/pilot/artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-results/pilot/report', open: 'never' }],
    ['json', { outputFile: '../../test-results/pilot/report.json' }],
  ],
  use: {
    baseURL: process.env.PILOT_BASE_URL ?? 'http://localhost:3400',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    launchOptions: { executablePath: chromium },
  },
  projects: [{ name: probe ? `pilot-${probe}` : 'pilot-journey' }],
});
