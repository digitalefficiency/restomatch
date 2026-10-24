// Layer-2 walk for the supplier portal (flag `supplierConfirm`) against a PRODUCTION build.
//   PORTAL_TOKEN=<live demo token> ANSWERED_PO=<po id with a seeded answer> node apps/web/e2e-supplier-confirm.mjs
// Screenshots → docs/client-ready/screenshots/supplier-confirm-*.png; prints a JSON report.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const PW = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const TOKEN = process.env.PORTAL_TOKEN;
const ANSWERED_PO = process.env.ANSWERED_PO;
const OUT = new URL('../../docs/client-ready/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
if (!TOKEN || !ANSWERED_PO) throw new Error('PORTAL_TOKEN and ANSWERED_PO are required');

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const report = [];

async function open(locale, width, path, { login = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
  const page = await ctx.newPage();
  const consoleErrors = [];
  const serverErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
  page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
  if (login) {
    await page.goto(`${BASE}/login`);
    await page.fill('#email', 'owner@kfar-hazeitim.test');
    await page.fill('#password', PW);
    await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 30000 }), page.click('form button[type=submit]')]);
  }
  const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
  const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  return { ctx, page, status: res?.status() ?? 0, html, consoleErrors, serverErrors, overflow };
}

// 1. The portal, view only, he/en × 1366/390 (no session).
for (const locale of ['he', 'en']) {
  for (const width of [1366, 390]) {
    const r = await open(locale, width, `/s/${TOKEN}`);
    const text = await r.page.innerText('body');
    await r.page.screenshot({ path: `${OUT}supplier-confirm-portal-${locale}-${width}.png`, fullPage: true });
    report.push({
      check: 'portal',
      locale,
      width,
      status: r.status,
      ...r.html,
      overflow: r.overflow,
      hasConfirm: /אישור ההזמנה כפי שהיא|Confirm the order as is/.test(text),
      consoleErrors: r.consoleErrors,
      serverErrors: r.serverErrors,
    });
    await r.ctx.close();
  }
}

// 2. Unknown token → 404 page.
{
  const r = await open('he', 390, `/s/${'A'.repeat(43)}`);
  report.push({ check: 'bad-token', status: r.status, consoleErrors: r.consoleErrors.filter((e) => !/404/.test(e)), serverErrors: r.serverErrors });
  await r.ctx.close();
}

// 3. Submit a shortage on the first line (he, 390) → done; reopening shows "already answered".
{
  const r = await open('he', 390, `/s/${TOKEN}`);
  const qty = r.page.locator('input[inputmode="decimal"]').first();
  await qty.fill('1');
  await r.page.click('button[type=submit]');
  await r.page.waitForSelector('[role=status]', { timeout: 15000 });
  const done = await r.page.innerText('[role=status]');
  await r.page.screenshot({ path: `${OUT}supplier-confirm-done-he-390.png`, fullPage: true });
  await r.page.reload({ waitUntil: 'networkidle' });
  const again = await r.page.innerText('body');
  report.push({
    check: 'submit',
    done: /תודה/.test(done),
    alreadyOnReload: /כבר התקבלה תשובה/.test(again),
    consoleErrors: r.consoleErrors,
    serverErrors: r.serverErrors,
  });
  await r.ctx.close();
}

// 4. Owner sees the differences on the answered order, he/en × 1366/390.
for (const locale of ['he', 'en']) {
  for (const width of [1366, 390]) {
    const r = await open(locale, width, `/dashboard/orders/${ANSWERED_PO}`, { login: true });
    const card = await r.page.locator('[data-testid=supplier-confirm-card]').innerText().catch(() => '');
    await r.page.locator('[data-testid=supplier-confirm-card]').scrollIntoViewIfNeeded().catch(() => {});
    await r.page.screenshot({ path: `${OUT}supplier-confirm-order-${locale}-${width}.png`, fullPage: true });
    report.push({
      check: 'order-card',
      locale,
      width,
      status: r.status,
      ...r.html,
      overflow: r.overflow,
      cardShowsChanges: /הספק סימן שינויים|The supplier marked changes/.test(card),
      consoleErrors: r.consoleErrors,
      serverErrors: r.serverErrors,
    });
    await r.ctx.close();
  }
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
