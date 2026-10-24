import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * Demo-path suite (e2e/demo-path.spec.ts): DEMO-PACK §4 click by click, against
 * an ALREADY RUNNING production build. Unlike playwright.config.ts it starts no
 * server and never seeds — e2e/run-demo-path.sh does both (DEMO_TODAY seed incl.
 * the chain demo, `next build`, `next start`, worker).
 *
 *   DEMO_BASE_URL   the `next start` (NODE_ENV=production) server     — owner, bookkeeper, landing
 *   DEMO_STUB_URL   the same build with the dev OCR stub switched on  — receiver (optional)
 *   DEMO_DATABASE_URL  owner connection to the seeded DB (fixtures: PO ids, receipt clones)
 *
 * Four projects: desktop 1366 and phone 390, each in Hebrew and English.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  return !process.env.CI && existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;
}

const desktop = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const MATRIX = [
  { name: 'desktop-he', use: { ...desktop, locale: 'he-IL' } },
  { name: 'desktop-en', use: { ...desktop, locale: 'en-US' } },
  { name: 'phone-he', use: { ...phone, locale: 'he-IL' } },
  { name: 'phone-en', use: { ...phone, locale: 'en-US' } },
];
const RECEIVER_LEG = /C · receiver/;

export default defineConfig({
  testDir: './e2e',
  testMatch: /demo-path\.spec\.ts/,
  outputDir: 'test-results/demo-path',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/demo-path/report.json' }]],
  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:3320',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 60_000,
    // A blocked click fails in 20 s with the culprit named, not after the 3-min test timeout.
    actionTimeout: 20_000,
    launchOptions: { executablePath: chromiumPath() },
  },
  // The receiver legs CONFIRM a delivery — that adds a matched invoice and moves
  // the owner's ₪ — so they run after every owner/landing/bookkeeper leg.
  projects: [
    ...MATRIX.map((p) => ({ ...p, grepInvert: RECEIVER_LEG })),
    ...MATRIX.map((p) => ({
      ...p,
      name: `${p.name}:receiver`,
      grep: RECEIVER_LEG,
      dependencies: MATRIX.map((m) => m.name),
    })),
  ],
});
