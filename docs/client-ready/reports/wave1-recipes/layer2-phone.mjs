// Layer-2: recipes surfaces at 1366 and 390 (phone), he + en — no page-level
// horizontal overflow, alert visible, zero console errors / 5xx.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/restomatch/apps/web/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? '/tmp/claude-0/s17/shots';
const results = []; let failures = 0;
const check = (ok, msg) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const overflow = (page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const offenders = [...document.querySelectorAll('main *')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    // Elements inside an intentional horizontal scroller are fine.
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false;
    }
    return r.right > w + 1 || r.left < -1;
  }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
  return { sw: document.documentElement.scrollWidth, w, offenders };
});
try {
  for (const [vw, vh] of [[1366, 900], [390, 844]]) {
    for (const locale of ['he', 'en']) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
      await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
      const page = await ctx.newPage();
      const errs = [], s5 = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      page.on('pageerror', (e) => errs.push(String(e)));
      page.on('response', (r) => { if (r.status() >= 500) s5.push(`${r.status()} ${r.url()}`); });
      await page.goto(`${BASE}/login`);
      const form = page.locator('form', { has: page.locator('input[name="password"]') });
      await form.locator('input[name="email"]').fill('owner@kfar-hazeitim.test');
      await form.locator('input[name="password"]').fill('RestoMatch-Demo-2026!');
      await form.locator('button[type="submit"]').click();
      await page.waitForURL(/\/dashboard/, { timeout: 30000 });
      const tag = `${vw}/${locale}`;
      await page.locator('[data-testid="recipes-overview-card"]').waitFor({ timeout: 15000 }).catch(() => {});
      let o = await overflow(page);
      check(o.sw <= o.w + 1 && o.offenders.length === 0, `[${tag}] /dashboard no horizontal overflow (sw ${o.sw} vs ${o.w}) ${o.offenders.join(' ')}`);
      await page.locator('[data-testid="recipes-overview-card"]').screenshot({ path: `${SHOTS}/overview-card-${locale}-${vw}.png` }).catch(() => {});
      await page.goto(`${BASE}/dashboard/recipes`);
      await page.waitForSelector('main table', { timeout: 20000 }).catch(() => {});
      await page.locator('[data-testid="dish-price-alert"]').first().waitFor({ timeout: 15000 }).catch(() => {});
      check((await page.locator('[data-testid="dish-price-alert"]').count()) === 1, `[${tag}] list: price alert rendered`);
      o = await overflow(page);
      check(o.sw <= o.w + 1 && o.offenders.length === 0, `[${tag}] recipes list no horizontal overflow (sw ${o.sw} vs ${o.w}) ${o.offenders.join(' ')}`);
      await page.screenshot({ path: `${SHOTS}/recipes-list-${locale}-${vw}.png`, fullPage: true });
      for (const [he, en] of [['מה השתנה החודש', 'What changed this month'], ['מה אם המחיר יעלה?', 'What if a price rises?'], ['תיאורטי מול בפועל', 'Theoretical vs actual'], ['ייבוא מ-CSV', 'Import CSV']]) {
        const tab = page.getByRole('tab', { name: locale === 'he' ? he : en });
        if (!(await tab.count())) { check(false, `[${tag}] tab "${locale === 'he' ? he : en}" present`); continue; }
        await tab.click();
        await page.waitForTimeout(1500);
        o = await overflow(page);
        check(o.sw <= o.w + 1 && o.offenders.length === 0, `[${tag}] tab "${en}" no horizontal overflow (sw ${o.sw} vs ${o.w}) ${o.offenders.join(' ')}`);
        if (vw === 390) await page.screenshot({ path: `${SHOTS}/recipes-${en.split(' ')[0].toLowerCase()}-${locale}-390.png`, fullPage: true });
      }
      // Editor of the alerted dish.
      await page.getByRole('tab', { name: locale === 'he' ? 'מנות' : 'Dishes' }).click().catch(() => {});
      await page.locator('main table').waitFor({ timeout: 15000 }).catch(() => {});
      await page.locator('main a', { hasText: locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak' }).first().click();
      await page.waitForURL(/\/dashboard\/recipes\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
      await page.locator('[role="alert"][data-testid="dish-price-alert"]').waitFor({ timeout: 15000 }).catch(() => {});
      check((await page.locator('[role="alert"][data-testid="dish-price-alert"]').count()) === 1, `[${tag}] editor: alert banner rendered`);
      o = await overflow(page);
      check(o.sw <= o.w + 1 && o.offenders.length === 0, `[${tag}] editor no horizontal overflow (sw ${o.sw} vs ${o.w}) ${o.offenders.join(' ')}`);
      await page.screenshot({ path: `${SHOTS}/recipe-editor-${locale}-${vw}.png`, fullPage: true });
      check(errs.length === 0, `[${tag}] zero console errors ${errs.slice(0, 2).join(' | ')}`);
      check(s5.length === 0, `[${tag}] zero 5xx ${s5.slice(0, 2).join(' | ')}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exitCode = failures ? 1 : 0;
}
