// Layer-2: owner-overview recipes card + NUM-10 on the production build.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire('/home/user/restomatch/apps/web/package.json');
const { chromium } = require('@playwright/test');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? '/tmp/claude-0/s17/shots';
const DB = 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const psql = (q) => execSync(`psql ${DB} -At`, { input: q }).toString().trim();
const results = [];
let failures = 0;
const check = (ok, msg) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };
const RID = psql(`select id from restaurants order by created_at limit 1;`);

async function session(browser, role, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  const consoleErrors = [], serverErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  const form = page.locator('form', { has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
  await form.locator('input[name="password"]').fill('RestoMatch-Demo-2026!');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  return { ctx, page, consoleErrors, serverErrors };
}
async function overview(page) {
  const r = await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector('main h1, main h2', { timeout: 20000 });
  await page.waitForTimeout(1500);
  return r;
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const locale of ['he', 'en']) {
    for (const role of ['owner', 'manager', 'chef', 'receiver', 'bookkeeper']) {
      const s = await session(browser, role, locale);
      const r = await overview(s.page);
      check(r && r.status() < 400, `[${locale}/${role}] /dashboard → ${r?.status()}`);
      const card = s.page.locator('[data-testid="recipes-overview-card"]');
      const sees = ['owner', 'manager', 'chef'].includes(role);
      if (sees) {
        await card.waitFor({ timeout: 15000 }).catch(() => {});
        const txt = (await card.count()) ? await card.innerText() : '';
        check(txt.includes(locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak'), `[${locale}/${role}] card lists the steak`);
        check(/\+[\s‎‏]*₪?[\s‎‏]*3[.,]10/.test(txt), `[${locale}/${role}] card shows +₪3.10 per plate`);
        check(/32[.,]8\s?%/.test(txt) && /34[.,]9\s?%/.test(txt), `[${locale}/${role}] card shows 32.8% → 34.9%`);
        check((await card.locator('a[href="/dashboard/recipes"]').count()) === 1, `[${locale}/${role}] card links to /dashboard/recipes`);
        if (role === 'owner') await s.page.screenshot({ path: `${SHOTS}/overview-card-${locale}.png`, fullPage: true });
      } else {
        check((await card.count()) === 0, `[${locale}/${role}] no recipes card`);
      }
      const kpiText = await s.page.locator('main').innerText();
      check(/[0-9]+([.,][0-9])?\s?%/.test(kpiText), `[${locale}/${role}] clean-match KPI shows a % (demo has match runs this week)`);
      check(s.consoleErrors.length === 0, `[${locale}/${role}] zero console errors ${s.consoleErrors.slice(0, 2).join(' | ')}`);
      check(s.serverErrors.length === 0, `[${locale}/${role}] zero 5xx ${s.serverErrors.slice(0, 2).join(' | ')}`);
      await s.ctx.close();
    }
  }
  // Flag off → card gone.
  const before = psql(`select settings::text from restaurants where id='${RID}';`);
  psql(`update restaurants set settings = jsonb_set(settings, '{features,recipes}', 'false') where id='${RID}';`);
  try {
    const s = await session(browser, 'owner', 'he');
    await overview(s.page);
    check((await s.page.locator('[data-testid="recipes-overview-card"]').count()) === 0, '[flag off] no recipes card');
    check(s.serverErrors.length === 0, '[flag off] zero 5xx');
    await s.ctx.close();
  } finally {
    psql(`update restaurants set settings = $j$${before}$j$::jsonb where id='${RID}';`);
  }
  // NUM-10: no match runs in the last 7 days → "—" + "no matches yet", never 100%.
  psql(`update match_runs set run_at = run_at - interval '30 days' where restaurant_id='${RID}';`);
  try {
    for (const locale of ['he', 'en']) {
      const s = await session(browser, 'owner', locale);
      await overview(s.page);
      const txt = await s.page.locator('main').innerText();
      check(txt.includes(locale === 'he' ? 'אין התאמות עדיין השבוע' : 'No matches yet this week'), `[NUM-10 ${locale}] "no matches yet" shown`);
      check(!/100\s?%/.test(txt), `[NUM-10 ${locale}] no fake 100%`);
      check(s.consoleErrors.length === 0 && s.serverErrors.length === 0, `[NUM-10 ${locale}] zero console errors / 5xx`);
      await s.page.screenshot({ path: `${SHOTS}/overview-num10-${locale}.png`, fullPage: false });
      await s.ctx.close();
    }
  } finally {
    psql(`update match_runs set run_at = run_at + interval '30 days' where restaurant_id='${RID}';`);
  }
} finally {
  await browser.close();
}
console.log(results.filter((r) => r.startsWith('FAIL')).join('\n') + '\n----');
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
