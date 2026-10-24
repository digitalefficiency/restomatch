// Layer-2 for inventory counting on the production build: he/en × 1366/390 — axe AA 0, no overflow, touch
// targets (390), seeded October period card (31.0%), recipes-page KPI card, count detail, draft count screen.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/user/restomatch/apps/web/package.json');
const { chromium } = require('@playwright/test');
const AXE = readFileSync('/home/user/restomatch/node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js', 'utf8');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? '/tmp/claude-0/s17/shots/inv';
const results = []; let failures = 0;
const check = (ok, msg) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
async function audit(page, tag, phone) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id}×${x.nodes.length} ${x.nodes[0].target.join(' ')}`));
  check(v.length === 0, `${tag} axe 0 ${v.slice(0, 3).join(' | ')}`);
  const lay = await page.evaluate((phone) => {
    const out = []; const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > w + 1) out.push(`scrollWidth ${document.documentElement.scrollWidth} > ${w}`);
    if (phone) for (const el of document.querySelectorAll('main button, main select, main input, main [role=button], main a[href]')) {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || el.closest('.sr-only')) continue;
      if (el.tagName === 'A' && s.display === 'inline') continue;
      if (el instanceof HTMLInputElement && ['hidden', 'file', 'checkbox', 'radio'].includes(el.type)) continue;
      if (r.width < 44 || r.height < 44) out.push(`${Math.round(r.width)}×${Math.round(r.height)} ${el.outerHTML.slice(0, 200)}`);
    }
    return out;
  }, phone);
  check(lay.length === 0, `${tag} no overflow${phone ? ' + 44px targets' : ''} ${lay.slice(0, 3).join(' | ')}`);
}
try {
  for (const [vw, vh] of [[1366, 900], [390, 844]]) for (const locale of ['he', 'en']) {
    const phone = vw === 390;
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: phone, hasTouch: phone });
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
    const tag = `[${vw}/${locale}]`;
    // nav link
    check((await page.locator('a[href="/dashboard/inventory"]').count()) > 0, `${tag} nav link to inventory`);
    await page.goto(`${BASE}/dashboard/inventory`);
    const card = page.getByTestId('food-cost-period');
    await card.waitFor({ timeout: 15000 });
    await page.getByTestId('food-cost-actual').waitFor({ timeout: 15000 });
    const ct = await card.innerText();
    check(/30[.,]2\s?%/.test(ct), `${tag} period: 30.2% actual food cost`);
    check(/11,134|11,134/.test(ct.replace(/[‎‏]/g, '')) && /43,939/.test(ct.replace(/[‎‏]/g, '')) && /13,474/.test(ct.replace(/[‎‏]/g, '')), `${tag} period formula ₪11,134 + ₪43,939 − credits ₪464 − ₪13,474`);
    check(/136,400/.test(ct.replace(/[‎‏]/g, '')), `${tag} period sales ₪136,400 (manual)`);
    check(ct.includes(locale === 'he' ? 'תעודות משלוח' : 'delivery notes'), `${tag} unbilled delivery notes shown as info`);
    const hist = await page.getByTestId('count-history').innerText();
    check(/13,474/.test(hist.replace(/[‎‏]/g, '')) && /11,134/.test(hist.replace(/[‎‏]/g, '')), `${tag} history lists both counts with ₪ value`);
    await audit(page, `${tag} /dashboard/inventory`, phone);
    if (process.env.SHOTS_ONLY) await page.screenshot({ path: `${SHOTS}/inventory-home-${locale}-${vw}.png`, fullPage: true });
    // detail of the closing count
    await page.getByTestId('count-history').locator('a').first().click();
    await page.waitForURL(/\/dashboard\/inventory\/[0-9a-f-]{36}$/);
    await page.locator('main h1').waitFor();
    const det = await page.locator('main').innerText();
    check(/13,474/.test(det.replace(/[‎‏]/g, '')), `${tag} count detail shows ₪13,474`);
    await audit(page, `${tag} count detail`, phone);
    if (process.env.SHOTS_ONLY) await page.screenshot({ path: `${SHOTS}/inventory-detail-${locale}-${vw}.png`, fullPage: true });
    // recipes page KPI card
    await page.goto(`${BASE}/dashboard/recipes`);
    await page.getByTestId('food-cost-actual').waitFor({ timeout: 15000 });
    check(/30[.,]2\s?%/.test(await page.getByTestId('food-cost-period').innerText()), `${tag} recipes page: actual food cost card 30.2%`);
    await audit(page, `${tag} /dashboard/recipes (with period card)`, phone);
    // count screen (creates a draft; discarded at the end)
    await page.goto(`${BASE}/dashboard/inventory`);
    await page.getByRole('button', { name: locale === 'he' ? 'התחלת ספירה' : 'Start a count' }).click();
    await page.waitForURL(/\/count$/);
    await page.getByTestId('count-progress').waitFor();
    await page.locator('main input[inputmode="decimal"][id^="qty-"]').first().fill('3');
    await page.waitForTimeout(1500);
    await audit(page, `${tag} count screen`, phone);
    if (process.env.SHOTS_ONLY) await page.screenshot({ path: `${SHOTS}/inventory-count-${locale}-${vw}.png`, fullPage: true });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: locale === 'he' ? 'ביטול הספירה' : 'Discard this count' }).click();
    await page.waitForTimeout(1500);
    check(errs.length === 0, `${tag} zero console errors ${errs.slice(0, 2).join(' | ')}`);
    check(s5.length === 0, `${tag} zero 5xx ${s5.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exitCode = failures ? 1 : 0;
}
