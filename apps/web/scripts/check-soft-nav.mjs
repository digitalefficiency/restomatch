#!/usr/bin/env node
/**
 * Production-build regression check: same-route soft navigations that only
 * change search params (the dashboard view controls) must COMMIT.
 *
 * Why: with a route-level `loading.tsx` above a slow page, Next 15.5 (prod
 * build only — `next dev` does not reproduce) left same-route navigations
 * suspended forever: the RSC response arrived, React's transition lanes stayed
 * suspended and never pinged, the URL and the period select reverted. Removing
 * `app/dashboard/loading.tsx` + `app/dashboard/leaks/loading.tsx` fixed it
 * (6/6 on every page). This script guards that.
 *
 * Usage (against `next build && next start`, seeded demo tenant):
 *   BASE_URL=http://localhost:3000 node apps/web/scripts/check-soft-nav.mjs
 * Env: BASE_URL (required), EMAIL (owner@kfar-hazeitim.test), PASSWORD (seed
 * DEFAULT_DEMO_PASSWORD), ROUNDS (6), PW_CHROMIUM_PATH (optional executable).
 * Exits 1 if any navigation fails to commit.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error('BASE_URL is required (a `next start` server)');
  process.exit(2);
}
const EMAIL = process.env.EMAIL ?? 'owner@kfar-hazeitim.test';
const PASSWORD = process.env.PASSWORD ?? 'RestoMatch-Demo-2026!';
const ROUNDS = Number(process.env.ROUNDS ?? 6);
const PERIODS = ['quarter', 'ytd', 'last_month', 'last_12m'];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const form = page.locator('form:has(input[type=password])');
await form.locator('input[type=email]').fill(EMAIL);
await form.locator('input[type=password]').fill(PASSWORD);
await form.locator('button[type=submit]').click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

/** Change one search param `rounds` times on `path`; count the navigations that stick. */
async function check(label, path, apply, expectInUrl) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  let ok = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const value = PERIODS[i % PERIODS.length];
    await apply(value, i);
    const want = expectInUrl(value, i);
    let committed = false;
    for (let k = 0; k < 40 && !committed; k++) {
      await page.waitForTimeout(100);
      committed = page.url().includes(want);
    }
    await page.waitForTimeout(500); // must not revert
    if (committed && page.url().includes(want)) ok++;
  }
  console.log(`${ok === ROUNDS ? 'PASS' : 'FAIL'} ${label}: ${ok}/${ROUNDS}`);
  return ok === ROUNDS;
}

const toolbarPeriod = (v) => page.locator('[role=toolbar] select').first().selectOption(v);
const results = [
  await check('overview period (toolbar)', '/dashboard', toolbarPeriod, (v) => `p=${v}`),
  await check('breakdown period (toolbar)', '/dashboard/leaks/breakdown', toolbarPeriod, (v) => `p=${v}`),
  await check(
    'breakdown month offset (router.replace)',
    '/dashboard/leaks/breakdown',
    (_v, i) => page.evaluate((m) => window.next.router.replace(`/dashboard/leaks/breakdown?m=${m}`), -1 - (i % 3)),
    (_v, i) => `m=${-1 - (i % 3)}`,
  ),
  // Explorer toolbar selects: period (0), compare (1), group-by (2).
  await check(
    'leaks explorer group-by (toolbar)',
    '/dashboard/leaks',
    (_v, i) => page.locator('[role=toolbar] select').nth(2).selectOption(['category', 'product', 'type'][i % 3]),
    (_v, i) => `g=${['category', 'product', 'type'][i % 3]}`,
  ),
];
if (errors.length) console.log('page errors:', errors.slice(0, 3));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
