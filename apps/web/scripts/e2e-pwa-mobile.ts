/**
 * Receiver PWA offline queue on a phone (390×844), per locale — run against
 * `next start` on a LOCAL demo DB:
 *   E2E_LOCALES=he,ar E2E_BASE_URL=http://localhost:3000 DATABASE_URL=postgres://…localhost…/db \
 *     PW_CHROMIUM_PATH=… pnpm exec tsx scripts/e2e-pwa-mobile.ts
 *
 * The locale goes in the `rm_locale` cookie, so receiver languages (ar / ru /
 * th / ti, flag receiverLanguages) are exercised the same way as he / en. Checks:
 * <html dir> matches the language; SW scope; the offline banner and the queued
 * photo; the banner is inside the viewport and not covered (bottom nav, cookie
 * bar); the static offline page; axe color-contrast (WCAG AA) = 0 on the offline
 * states; zero console errors besides the deliberate network failures.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page, type Route } from '@playwright/test';
import postgres from 'postgres';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB_URL = process.env.DATABASE_URL ?? '';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const LOCALES = (process.env.E2E_LOCALES ?? 'he,ar').split(',').map((s) => s.trim()).filter(Boolean);
const SHOTS = resolve(process.cwd(), '../../docs/client-ready/screenshots');
const RTL = new Set(['he', 'ar']);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) throw new Error('DATABASE_URL must be a LOCAL database');
const sql = postgres(DB_URL, { max: 2 });
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

let checks = 0;
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  checks += 1;
  console.log(`  ✓ ${msg}`);
}

async function contrastViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error injected by addScriptTag
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return (r.violations as Array<{ nodes: Array<{ target: string[] }> }>).flatMap((v) => v.nodes.map((n) => n.target.join(' ')));
  });
}

async function queueCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((res) => {
        const req = indexedDB.open('restomatch-receiver', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'clientUploadId' });
        req.onsuccess = () => {
          const c = req.result.transaction('photos', 'readonly').objectStore('photos').count();
          c.onsuccess = () => {
            req.result.close();
            res(c.result);
          };
        };
        req.onerror = () => res(-1);
      }),
  );
}

/** Not covered: the element at the banner's centre is the banner (or inside it). */
async function uncovered(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, testId);
}

async function run(browser: Browser, locale: string, rid: string) {
  console.log(`\n[pwa-mobile] receiver offline queue / ${locale} @ 390`);
  const [po] = await sql<{ id: string }[]>`
    select id from purchase_orders where restaurant_id = ${rid} and status in ('sent','confirmed')
    order by expected_delivery_at nulls last limit 1`;
  check(po, 'an open PO to receive');
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE },
    { name: 'rm_locale', value: locale, url: BASE },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR_/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/login`);
  const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill('receiver@kfar-hazeitim.test');
  await form.locator('input[name="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 120_000 }), form.locator('button[type="submit"]').click()]);

  await page.goto(`${BASE}/dashboard/receiving?source=pwa`, { waitUntil: 'networkidle' });
  const lang = await page.locator('html').getAttribute('lang');
  const dir = await page.locator('html').getAttribute('dir');
  console.log(`    <html lang=${lang} dir=${dir}>`);
  check(dir === (RTL.has(locale) ? 'rtl' : 'ltr'), `<html dir=${dir}> matches ${locale}`);
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  check(scope.endsWith('/dashboard/receiving'), 'service worker controls /dashboard/receiving');

  await page.goto(`${BASE}/dashboard/receiving/${po!.id}`, { waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const banner = page.getByTestId('pwa-offline-banner');
  await banner.waitFor({ timeout: 10_000 });
  console.log(`    banner: ${JSON.stringify((await banner.innerText()).replace(/\s+/g, ' ').slice(0, 120))}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  check(await uncovered(page, 'pwa-offline-banner'), 'offline banner inside the viewport and not covered');
  await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: PNG });
  for (let i = 0; i < 30 && (await queueCount(page)) < 1; i += 1) await page.waitForTimeout(500);
  check((await queueCount(page)) >= 1, 'photo taken offline is queued in IndexedDB');
  const bad = await contrastViolations(page);
  check(bad.length === 0, `axe color-contrast on the offline wizard: ${bad.length} violations ${bad.join(' | ')}`);
  await page.screenshot({ path: join(SHOTS, `pwa-mobile-offline-${locale}.png`) });

  // Offline navigation → the SW's static offline page (setOffline does not reach SW fetches).
  const abort = (route: Route) => route.abort('internetdisconnected');
  await context.route(`${BASE}/dashboard/**`, abort);
  await page.goto(`${BASE}/dashboard/receiving`).catch(() => null);
  check(/You are offline/.test(await page.locator('body').innerText()), 'offline navigation → SW offline page');
  const badOffline = await contrastViolations(page);
  check(badOffline.length === 0, `axe color-contrast on the offline page: ${badOffline.length} violations`);
  await context.unroute(`${BASE}/dashboard/**`, abort);
  await context.setOffline(false);

  check(errors.length === 0, `zero console errors (${errors.join(' | ') || 'none'})`);
  await context.close();
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = 'כפר הזיתים' limit 1`;
    for (const locale of LOCALES) await run(browser, locale, r!.id);
    console.log(`\nPASS (pwa-mobile ${LOCALES.join('+')}): ${checks} checks`);
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
