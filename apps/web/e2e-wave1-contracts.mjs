// Layer-2 walk for wave-1 contracts/priceAlerts against a PRODUCTION build (next start :3100).
// node apps/web/e2e-wave1-contracts.mjs  → prints a JSON report; screenshots → docs/client-ready/screenshots/
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const PW = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const OUT = new URL('../../docs/client-ready/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SUPPLIER = process.env.SUPPLIER_ID;
const INVOICE = process.env.INVOICE_ID;

const pages = [
  { key: 'contracts', path: '/dashboard/contracts', expect: ['₪'] },
  { key: 'alerts', path: '/dashboard/contracts?tab=alerts', expect: ['18%'] },
  { key: 'thresholds', path: '/dashboard/contracts?tab=thresholds', expect: ['10%'] },
  { key: 'import', path: '/dashboard/contracts/import', expect: [] },
  { key: 'supplier-contract', path: `/dashboard/suppliers/${SUPPLIER}?tab=contract`, expect: ['139'] },
  { key: 'invoice', path: `/dashboard/invoices/${INVOICE}`, expect: [] },
  { key: 'leaks', path: '/dashboard/leaks', expect: [] },
  { key: 'overview', path: '/dashboard', expect: [] },
];
const roles = {
  owner: pages.map((p) => p.key),
  manager: pages.map((p) => p.key),
  bookkeeper: ['contracts', 'alerts', 'thresholds', 'leaks', 'overview'],
  receiver: ['contracts'], // must NOT reach it
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = [];
for (const [role, keys] of Object.entries(roles)) {
  for (const locale of ['he', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }]);
    const page = await ctx.newPage();
    const consoleErrors = [];
    const serverErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
    page.on('response', (r) => r.status() >= 500 && serverErrors.push(`${r.status()} ${r.url()}`));
    await page.goto(`${BASE}/login`);
    await page.fill('#email', `${role}@kfar-hazeitim.test`);
    await page.fill('#password', PW);
    await Promise.all([page.waitForURL(/\/dashboard|\/onboarding|\/receiving/, { timeout: 30000 }), page.click('form button[type=submit]')]);
    for (const key of keys) {
      const p = pages.find((x) => x.key === key);
      consoleErrors.length = 0;
      serverErrors.length = 0;
      const res = await page.goto(BASE + p.path, { waitUntil: 'networkidle' });
      const status = res?.status() ?? 0;
      const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
      const text = await page.innerText('body');
      const missing = p.expect.filter((s) => !text.includes(s));
      const overContract = /מעל החוזה|over contract/i.test(text);
      if (role === 'owner' || (role === 'manager' && ['contracts', 'alerts', 'invoice'].includes(key))) {
        await page.screenshot({ path: `${OUT}wave1-${key}-${locale}${role === 'owner' ? '' : '-' + role}.png`, fullPage: true });
      }
      report.push({ role, locale, key, status, finalUrl: page.url().replace(BASE, ''), ...html, missing, overContract, consoleErrors: [...consoleErrors], serverErrors: [...serverErrors] });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
