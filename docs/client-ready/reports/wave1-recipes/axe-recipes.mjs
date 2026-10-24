// axe AA on the wave-1 recipes screens: he/en × 1366/390, every recipes tab, editor, new-dish, overview card.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/user/restomatch/apps/web/package.json');
const { chromium } = require('@playwright/test');
const AXE = readFileSync('/home/user/restomatch/node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js', 'utf8');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? '/tmp/claude-0/s17/shots/light';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let total = 0; const lines = [];
async function axe(page, label, include) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async (inc) => {
    const res = await window.axe.run(inc ? { include: [inc] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, nodes: v.nodes.slice(0, 3).map((x) => `${x.target.join(' ')} :: ${(x.failureSummary || '').split('\n').slice(1, 2).join('')}`) }));
  }, include ?? null);
  const n = r.reduce((s, v) => s + v.n, 0);
  total += n;
  lines.push(`${n === 0 ? 'OK  ' : 'FAIL'} ${label}: ${n} violation nodes${r.map((v) => `\n      - ${v.id} (${v.impact}) ×${v.n}\n        ${v.nodes.join('\n        ')}`).join('')}`);
}
try {
  for (const [vw, vh] of [[1366, 900], [390, 844]]) for (const locale of ['he', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
    const page = await ctx.newPage();
    const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(`${BASE}/login`);
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill('owner@kfar-hazeitim.test');
    await form.locator('input[name="password"]').fill('RestoMatch-Demo-2026!');
    await form.locator('button[type="submit"]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    const tag = `${vw}/${locale}`;
    const card = page.locator('[data-testid="recipes-overview-card"]');
    await card.waitFor({ timeout: 15000 }).catch(() => {});
    await axe(page, `[${tag}] overview card`, '[data-testid="recipes-overview-card"]');
    await card.screenshot({ path: `${SHOTS}/overview-card-${locale}-${vw}.png` }).catch(() => {});
    await page.goto(`${BASE}/dashboard/recipes`);
    await page.locator('[data-testid="dish-price-alert"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await axe(page, `[${tag}] recipes · dishes`, 'main');
    await page.screenshot({ path: `${SHOTS}/recipes-dishes-${locale}-${vw}.png`, fullPage: true });
    for (const [he, en, prep] of [
      ['מה השתנה החודש', 'What changed this month'],
      ['מה אם המחיר יעלה?', 'What if a price rises?', async () => {
        await page.fill('#impact-search', locale === 'he' ? 'חזה' : 'Chicken breast'); await page.waitForTimeout(800);
        await page.locator('#impact-product option').nth(1).waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        await page.selectOption('#impact-product', { index: 1 }).catch(() => {}); await page.fill('#impact-change', '12');
        await page.getByRole('button', { name: locale === 'he' ? 'חישוב' : 'Calculate' }).click(); await page.waitForTimeout(1500);
      }],
      ['תיאורטי מול בפועל', 'Theoretical vs actual'],
      ['ייבוא מ-CSV', 'Import CSV'],
    ]) {
      await page.getByRole('tab', { name: locale === 'he' ? he : en }).click();
      await page.waitForTimeout(1500);
      if (prep) await prep();
      await axe(page, `[${tag}] recipes · ${en}`, 'main');
      await page.screenshot({ path: `${SHOTS}/recipes-${en.split(' ')[0].toLowerCase()}-${locale}-${vw}.png`, fullPage: true });
    }
    await page.getByRole('tab', { name: locale === 'he' ? 'מנות' : 'Dishes' }).click();
    await page.locator('main a', { hasText: locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak' }).first().click();
    await page.waitForURL(/\/dashboard\/recipes\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
    await page.locator('[role="alert"][data-testid="dish-price-alert"]').waitFor({ timeout: 15000 }).catch(() => {});
    await axe(page, `[${tag}] editor (steak)`, 'main');
    await page.screenshot({ path: `${SHOTS}/editor-${locale}-${vw}.png`, fullPage: true });
    await page.goto(`${BASE}/dashboard/recipes/new`); await page.waitForTimeout(2000);
    await axe(page, `[${tag}] new dish`, 'main');
    lines.push(`${errs.length ? 'FAIL' : 'OK  '} [${tag}] console errors: ${errs.length} ${errs.slice(0, 2).join(' | ')}`);
    total += errs.length;
    await ctx.close();
  }
} finally {
  await browser.close();
  console.log(lines.join('\n'));
  console.log(`\nTOTAL violation nodes + console errors: ${total}`);
  process.exitCode = total ? 1 : 0;
}
