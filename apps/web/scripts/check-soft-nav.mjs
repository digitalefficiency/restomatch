#!/usr/bin/env node
/**
 * Production-build regression check: same-route soft navigations that only
 * change search params (the dashboard view controls) must COMMIT, as soft
 * navigations — no document reload.
 *
 * Why: with a route-level `loading.tsx` above a slow page, Next 15.5 (prod
 * build only — `next dev` does not reproduce) left same-route navigations
 * suspended forever: the RSC response arrived, React's transition lanes stayed
 * suspended and never pinged, the URL and the period select reverted. Removing
 * `app/dashboard/loading.tsx` + `app/dashboard/leaks/loading.tsx` fixed it
 * (6/6 on every page). This script guards that, in Hebrew and English.
 *
 * Usage (against `next build && next start`, seeded demo tenant):
 *   BASE_URL=http://localhost:3000 node apps/web/scripts/check-soft-nav.mjs
 * Env: BASE_URL (required), EMAIL (owner@kfar-hazeitim.test), PASSWORD (seed
 * DEFAULT_DEMO_PASSWORD), ROUNDS (6), LANGS (he,en), PW_CHROMIUM_PATH.
 * Exits 1 if any navigation fails to commit or falls back to a full reload.
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
const LANGS = (process.env.LANGS ?? 'he,en').split(',');
const PERIODS = ['quarter', 'ytd', 'last_month', 'last_12m'];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Production React reports a hydration mismatch (#418/#423/#425) through
// console.error, not as a page error — collect those too; any one fails the run.
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|hydrat/i;
const hydration = [];
page.on('console', (m) => {
  if (m.type() === 'error' && HYDRATION.test(m.text())) hydration.push(`${page.url()} ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => {
  if (HYDRATION.test(String(e))) hydration.push(`${page.url()} ${String(e).slice(0, 200)}`);
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
const form = page.locator('form:has(input[type=password])');
await form.locator('input[type=email]').fill(EMAIL);
await form.locator('input[type=password]').fill(PASSWORD);
await form.locator('button[type=submit]').click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

/**
 * Change one search param `ROUNDS` times on `path`; a round passes when the URL
 * commits, does not revert, and the document was NOT reloaded (a per-document
 * marker survives), so a full-reload fallback can never mask a stall.
 */
async function check(label, path, apply, expectInUrl) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__softNavDoc = Math.random();
  });
  const doc = await page.evaluate(() => window.__softNavDoc);
  let ok = 0;
  let reloads = 0;
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
    const sameDoc = (await page.evaluate(() => window.__softNavDoc).catch(() => null)) === doc;
    if (!sameDoc) {
      reloads++;
      await page.evaluate((d) => {
        window.__softNavDoc = d;
      }, doc);
    }
    if (committed && page.url().includes(want) && sameDoc) ok++;
  }
  const pass = ok === ROUNDS;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: ${ok}/${ROUNDS}${reloads ? ` (${reloads} full reloads)` : ''}`);
  return pass;
}

const toolbarSelect = (n) => (v) => page.locator('[role=toolbar] select').nth(n).selectOption(v);
const results = [];
for (const lang of LANGS) {
  // ?lang= sets the locale cookie for the session; the checks then run in it.
  await page.goto(`${BASE}/dashboard?lang=${lang}`, { waitUntil: 'networkidle' });
  results.push(
    await check(`[${lang}] overview period`, '/dashboard', toolbarSelect(0), (v) => `p=${v}`),
    await check(`[${lang}] chain period`, '/dashboard/chain', toolbarSelect(0), (v) => `p=${v}`),
    await check(`[${lang}] breakdown period`, '/dashboard/leaks/breakdown', toolbarSelect(0), (v) => `p=${v}`),
    await check(
      `[${lang}] breakdown month offset (router.replace)`,
      '/dashboard/leaks/breakdown',
      (_v, i) => page.evaluate((m) => window.next.router.replace(`/dashboard/leaks/breakdown?m=${m}`), -1 - (i % 3)),
      (_v, i) => `m=${-1 - (i % 3)}`,
    ),
    // Explorer toolbar selects: period (0), compare (1), group-by (2).
    await check(
      `[${lang}] leaks explorer group-by`,
      '/dashboard/leaks',
      (_v, i) => toolbarSelect(2)(['category', 'product', 'type'][i % 3]),
      (_v, i) => `g=${['category', 'product', 'type'][i % 3]}`,
    ),
  );
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  if (htmlLang !== lang) {
    console.log(`FAIL [${lang}] <html lang> is "${htmlLang}"`);
    results.push(false);
  }
}
if (errors.length) console.log('page errors:', errors.slice(0, 3));
await browser.close();
if (hydration.length) console.log(`FAIL hydration errors (${hydration.length}):`, hydration.slice(0, 3));
process.exit(results.every(Boolean) && hydration.length === 0 ? 0 : 1);
