// Captures REAL product screenshots from the locally running app (seeded demo
// tenant "כפר הזיתים") for the promo. Needs `./scripts/dev-setup.sh` +
// `pnpm --filter @restomatch/web dev` running. Uses the preinstalled Chromium.
//   node scripts/capture.mjs            → public/shots/*.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const EXE = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });

const states = new Map(); // email → storageState (one login per user; the login limiter is strict)
async function session(email, viewport, locale) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    storageState: states.get(email),
  });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  if (!states.has(email)) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 }), page.click('form button[type=submit] >> nth=0')]);
    states.set(email, await ctx.storageState());
  }
  return { ctx, page };
}

async function shot(page, path, name, { full = false, wait = 1500 } = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(wait);
  // hide Next dev indicator + cookie banners
  await page.addStyleTag({ content: 'nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none!important}' });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log('✓', name, path);
}

const ONLY = process.env.ONLY; // 'desktop' | 'receiver' | undefined (= all)
if (!ONLY || ONLY === 'desktop') for (const locale of ['he', 'en']) {
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard', `dashboard-${locale}`, { wait: 2500 });
  await shot(page, '/dashboard', `dashboard-${locale}-full`, { full: true });
  await shot(page, '/dashboard/leaks', `leaks-${locale}`, { full: true });
  await shot(page, '/dashboard/approvals', `approvals-${locale}`, { full: true });
  await shot(page, '/dashboard/leaks/claims', `claims-${locale}`, { full: true });
  await ctx.close();
}

if (!ONLY || ONLY === 'receiver') for (const locale of ['en', 'he']) {
  const { ctx, page } = await session('receiver@kfar-hazeitim.test', { width: 390, height: 844 }, locale);
  await shot(page, '/dashboard/receiving', `receiving-${locale}`, { full: true });
  // Open the first expected delivery → the receiving wizard for that PO.
  const hrefs = await page.locator('a[href^="/dashboard/receiving/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const href = hrefs[locale === 'en' ? 0 : 1];
  await shot(page, href, `receiving-po-${locale}`, { full: true, wait: 3000 });
  // Demo invoice (no upload) → stub OCR → reconciliation with English lines.
  if (locale === 'en') try {
    await page.setViewportSize({ width: 390, height: 1500 });
    // a 1×1 PNG: locally the dev OCR stub builds the invoice from the PO (one line +8% price, one +1 unit)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(1500);
    await page.locator('button', { hasText: locale === 'en' ? /Process invoice/i : /עיבוד|לעבד/ }).first().click();
    await page.waitForTimeout(12000);
    await page.waitForTimeout(1500);
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.screenshot({ path: `${OUT}/reconcile-${locale}.png` });
    console.log('✓', `reconcile-${locale}`);
  } catch (e) { console.log('✗ reconcile', locale, e.message.split('\n')[0]); }
  await ctx.close();
}
if (!ONLY || ONLY === 'desktop') {
const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 390, height: 844 }, 'he');
await shot(page, '/dashboard', 'dashboard-he-phone', { full: true, wait: 2500 });
await ctx.close();
}
if (ONLY === 'approvals') for (const locale of ['he', 'en']) {
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard/approvals', `approvals-${locale}`, { full: true, wait: 2500 });
  await ctx.close();
}
if (!ONLY || ONLY === 'chain') for (const locale of ['he', 'en']) {
  // Chain view (S8): needs `pnpm --filter @restomatch/worker seed:chain-demo` on top of the base demo.
  const { ctx, page } = await session('owner@kfar-hazeitim.test', { width: 1440, height: 900 }, locale);
  await shot(page, '/dashboard/chain', `chain-${locale}`, { full: true, wait: 3000 });
  await ctx.close();
}
await browser.close();
