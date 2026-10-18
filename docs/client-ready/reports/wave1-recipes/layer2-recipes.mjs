// Layer-2 functional check of /dashboard/recipes against a production build (next start).
// Usage: node layer2.mjs <baseUrl> <shotDir>
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('/home/user/restomatch/apps/web/package.json');
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] ?? 'http://localhost:3100';
const SHOTS = process.argv[3] ?? '/tmp/claude-0/s17/shots';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const DB = 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const results = [];
let failures = 0;
const check = (ok, msg) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};
const psql = (q) => execSync(`psql ${DB} -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();

async function session(browser, role, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  const consoleErrors = [];
  const serverErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${BASE}/login`);
  const form = page.locator('form', { has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  // Dismiss the cookie banner so it never covers a screenshot.
  const accept = page.getByRole('button', { name: locale === 'he' ? 'קבל הכל' : /accept all/i });
  if (await accept.count()) await accept.first().click().catch(() => {});
  return { ctx, page, consoleErrors, serverErrors };
}

async function htmlAttrs(page) {
  return page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const locale of ['he', 'en']) {
    const dir = locale === 'he' ? 'rtl' : 'ltr';
    for (const role of ['owner', 'manager', 'chef']) {
      const s = await session(browser, role, locale);
      const { page } = s;
      const navLink = await page.locator('header a[href="/dashboard/recipes"]').count();
      check(navLink > 0, `[${locale}/${role}] nav link to /dashboard/recipes visible`);
      const resp = await page.goto(`${BASE}/dashboard/recipes`);
      check(resp && resp.status() < 400, `[${locale}/${role}] GET /dashboard/recipes → ${resp?.status()}`);
      await page.waitForSelector('main table', { timeout: 20000 }).catch(() => {});
      const [lang, d] = await htmlAttrs(page);
      check(lang === locale && d === dir, `[${locale}/${role}] <html lang=${lang} dir=${d}>`);
      const body = await page.locator('main').innerText();
      const steak = locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak';
      check(body.includes(steak), `[${locale}/${role}] steak row listed`);
      check(body.includes('34.9%') || body.includes('34.9‎%') || /34[.,]9\s?%/.test(body), `[${locale}/${role}] steak food cost 34.9% shown`);
      check(/98[.,]80/.test(body), `[${locale}/${role}] steak margin ₪98.80 shown`);
      if (role === 'owner') await page.screenshot({ path: `${SHOTS}/recipes-list-${locale}.png`, fullPage: true });

      // What changed this month
      await page.getByRole('tab', { name: locale === 'he' ? 'מה השתנה החודש' : 'What changed this month' }).click();
      await page.waitForSelector('text=' + (locale === 'he' ? 'אנטריקוט' : 'Entrecôte'), { timeout: 15000 });
      const changes = await page.locator('main').innerText();
      check(/\+[\s\u200e\u200f]*₪?[\s\u200e\u200f]*3[.,]10/.test(changes), `[${locale}/${role}] changes: steak +₪3.10 per plate`);
      check(/139[.,]70/.test(changes) && /149[.,]00/.test(changes), `[${locale}/${role}] changes: why = entrecôte ₪139.70 → ₪149.00`);
      if (role === 'owner') await page.screenshot({ path: `${SHOTS}/recipes-changes-${locale}.png`, fullPage: true });

      // Price impact: chicken +12%
      await page.getByRole('tab', { name: locale === 'he' ? 'מה אם המחיר יעלה?' : 'What if a price rises?' }).click();
      await page.fill('#impact-search', locale === 'he' ? 'חזה' : 'Chicken breast');
      await page.waitForTimeout(800);
      const opt = page.locator('#impact-product option').nth(1);
      await opt.waitFor({ state: 'attached', timeout: 15000 });
      await page.selectOption('#impact-product', { index: 1 });
      await page.fill('#impact-change', '12');
      await page.getByRole('button', { name: locale === 'he' ? 'חישוב' : 'Calculate' }).click();
      await page.waitForSelector('text=' + (locale === 'he' ? 'שניצל' : 'Schnitzel'), { timeout: 15000 });
      const impact = await page.locator('main').innerText();
      check(impact.includes(locale === 'he' ? 'שניצל' : 'Schnitzel'), `[${locale}/${role}] impact: chicken +12% hits schnitzel`);
      if (role === 'owner') await page.screenshot({ path: `${SHOTS}/recipes-impact-${locale}.png`, fullPage: true });

      // Editor
      const steakId = psql(`select id from recipes where name_en = 'Entrecôte steak'`);
      const r2 = await page.goto(`${BASE}/dashboard/recipes/${steakId}`);
      check(r2 && r2.status() < 400, `[${locale}/${role}] editor → ${r2?.status()}`);
      await page.waitForSelector('#r-name', { timeout: 15000 });
      check((await page.inputValue('#r-name')) === 'סטייק אנטריקוט', `[${locale}/${role}] editor loads the recipe`);
      const ed = await page.locator('main').innerText();
      check(/52[.,]89/.test(ed), `[${locale}/${role}] editor shows ₪52.89 per plate`);
      if (role === 'owner') await page.screenshot({ path: `${SHOTS}/recipes-editor-${locale}.png`, fullPage: true });
      if (role === 'chef' && locale === 'he') {
        // Chef creates + deletes a dish through the UI (write path under the RLS app role).
        await page.goto(`${BASE}/dashboard/recipes/new`);
        await page.fill('#r-name', 'בדיקת שכבה 2');
        await page.fill('#r-price', '45');
        await page.fill('#r-add-product', 'חזה');
        await page.locator('#r-add-product-list button').first().click();
        await page.locator('input[id$="-q"]').first().fill('200');
        await page.getByRole('button', { name: 'שמירה' }).click();
        await page.waitForURL(/\/dashboard\/recipes\/[0-9a-f-]{36}$/, { timeout: 20000 });
        await page.waitForSelector('text=עלות לצלחת');
        const saved = psql(`select count(*) from recipes where name = 'בדיקת שכבה 2'`);
        check(saved === '1', `[he/chef] new dish saved through the UI`);
        page.once('dialog', (dlg) => dlg.accept());
        await page.getByRole('button', { name: 'מחיקה' }).click();
        await page.waitForURL(/\/dashboard\/recipes$/, { timeout: 20000 });
        check(psql(`select count(*) from recipes where name = 'בדיקת שכבה 2'`) === '0', `[he/chef] dish deleted through the UI`);
      }
      check(s.consoleErrors.length === 0, `[${locale}/${role}] zero console errors ${s.consoleErrors.slice(0, 3).join(' | ')}`);
      check(s.serverErrors.length === 0, `[${locale}/${role}] zero 5xx ${s.serverErrors.slice(0, 3).join(' | ')}`);
      await s.ctx.close();
    }
    for (const role of ['receiver', 'bookkeeper']) {
      const s = await session(browser, role, locale);
      const { page } = s;
      check((await page.locator('header a[href="/dashboard/recipes"]').count()) === 0, `[${locale}/${role}] no nav link`);
      await page.goto(`${BASE}/dashboard/recipes`);
      const body = await page.locator('body').innerText();
      check(!page.url().endsWith('/dashboard/recipes') || !body.includes(locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak'), `[${locale}/${role}] /dashboard/recipes not reachable (landed on ${new URL(page.url()).pathname})`);
      check(s.serverErrors.length === 0, `[${locale}/${role}] zero 5xx ${s.serverErrors.slice(0, 3).join(' | ')}`);
      await s.ctx.close();
    }
  }

  // Flag off for the demo tenant → invisible (nav hidden, page 404), then restore.
  const before = psql(`select settings::text from restaurants limit 1`);
  psql(`update restaurants set settings = jsonb_set(settings, '{features,recipes}', 'false')`);
  try {
    const s = await session(browser, 'owner', 'he');
    check((await s.page.locator('header a[href="/dashboard/recipes"]').count()) === 0, `[flag off] nav link hidden`);
    const r = await s.page.goto(`${BASE}/dashboard/recipes`);
    const offBody = await s.page.locator('body').innerText();
    // Streaming RSC (dashboard/loading.tsx) commits 200 before notFound(); the page must still be the 404 UI with no recipe data.
    check(!offBody.includes('סטייק אנטריקוט') && /404|לא נמצא|not found/i.test(offBody), `[flag off] /dashboard/recipes renders not-found (HTTP ${r?.status()})`);
    const api = await s.page.request.get(`${BASE}/api/trpc/recipes.list`);
    check(api.status() === 403, `[flag off] recipes.list over HTTP → ${api.status()} (want 403 FEATURE_DISABLED)`);
    check((await api.text()).includes('FEATURE_DISABLED'), `[flag off] appCode FEATURE_DISABLED on the wire`);
    await s.ctx.close();
  } finally {
    execSync(`psql ${DB} -At`, { input: `update restaurants set settings = $j$${before}$j$::jsonb;` });
  }
  check(psql(`select settings::text from restaurants limit 1`) === before, '[flag off] settings restored');
} finally {
  await browser.close();
}
console.log(results.filter((r) => r.startsWith("FAIL")).join("\n") + "\n----\n"); console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
