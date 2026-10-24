// Layer-2: "Theoretical vs actual" (POS) tab on the production build.
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
const hadTable = psql(`select to_regclass('public.pos_sales') is not null;`) === 't';
if (!hadTable) psql(`create table pos_sales (id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references restaurants(id) on delete cascade, sold_on date not null, item_ref varchar(64) not null, item_name text not null, qty numeric(12,3) not null, net_amount numeric(12,2) not null);
alter table pos_sales enable row level security;
create policy pos_sales_tenant on pos_sales using (restaurant_id = app.current_restaurant_id());
grant select on pos_sales to restomatch_app;`);
// Demo month: steak sold at a discount, schnitzel at menu price, a drink not linked to a recipe.
psql(`insert into pos_sales (restaurant_id, sold_on, item_ref, item_name, qty, net_amount) values
 ('${RID}', current_date, 'P-101', 'Entrecôte steak', 40, 5200.00),
 ('${RID}', current_date, 'P-102', 'שניצל עם צ׳יפס', 120, 6915.25),
 ('${RID}', current_date, 'P-900', 'Lemonade', 80, 1200.00),
 ('${RID}', current_date, 'P-103', 'Shakshuka', 10, 0.01);`);
async function session(browser, role, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addCookies([{ name: 'rm_locale', value: locale, url: BASE }, { name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await ctx.newPage();
  const errs = [], s5 = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 500) s5.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  const form = page.locator('form', { has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(`${role}@kfar-hazeitim.test`);
  await form.locator('input[name="password"]').fill('RestoMatch-Demo-2026!');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  return { ctx, page, errs, s5 };
}
const TAB = { he: 'תיאורטי מול בפועל', en: 'Theoretical vs actual' };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const locale of ['he', 'en']) {
    for (const role of ['owner', 'chef']) {
      const s = await session(browser, role, locale);
      await s.page.goto(`${BASE}/dashboard/recipes`);
      const tab = s.page.getByRole('tab', { name: TAB[locale] });
      await tab.waitFor({ timeout: 20000 }).catch(() => {});
      check((await tab.count()) === 1, `[${locale}/${role}] POS tab visible with both flags`);
      await tab.click();
      await s.page.waitForSelector('[data-testid="pos-table"]', { timeout: 20000 }).catch(() => {});
      const txt = await s.page.locator('main').innerText();
      check(txt.includes(locale === 'he' ? 'סטייק אנטריקוט' : 'Entrecôte steak'), `[${locale}/${role}] steak row`);
      // steak: 5289 × 40 = ₪2,115.60 cost; sales ₪5,200 → 40.7% actual vs 34.9% menu, avg ₪130.00
      check(/40[.,]7\s?%/.test(txt) && /34[.,]9\s?%/.test(txt), `[${locale}/${role}] steak 34.9% menu vs 40.7% actual`);
      check(/130[.,]00/.test(txt), `[${locale}/${role}] steak avg price charged ₪130.00`);
      check(/\+[\s‎‏]*5[.,]8\s?%/.test(txt), `[${locale}/${role}] steak gap +5.8 pts`);
      check(txt.includes(locale === 'he' ? 'פריטים בקופה לא מקושרים' : 'POS items are not linked'), `[${locale}/${role}] unlinked POS items note`);
      check((await s.page.locator('[data-testid="pos-unmatched"]').innerText().catch(() => '')).includes('Lemonade'), `[${locale}/${role}] unlinked item "Lemonade" listed with its sales`);
      check(txt.includes(locale === 'he' ? 'לבדוק בקופה' : 'Check POS data'), `[${locale}/${role}] ₪0.01 shakshuka sale flagged "check POS data", not a huge gap`);
      if (role === 'owner') await s.page.screenshot({ path: `${SHOTS}/recipes-pos-${locale}.png`, fullPage: true });
      check(s.errs.length === 0, `[${locale}/${role}] zero console errors ${s.errs.slice(0, 2).join(' | ')}`);
      check(s.s5.length === 0, `[${locale}/${role}] zero 5xx ${s.s5.slice(0, 2).join(' | ')}`);
      await s.ctx.close();
    }
  }
  // Last month: no POS rows → neutral empty state.
  {
    const s = await session(browser, 'owner', 'en');
    await s.page.goto(`${BASE}/dashboard/recipes`);
    await s.page.getByRole('tab', { name: TAB.en }).click();
    await s.page.getByRole('button', { name: 'Last month' }).click();
    await s.page.waitForSelector('text=No POS sales for this period yet', { timeout: 15000 }).catch(() => {});
    check((await s.page.locator('text=No POS sales for this period yet').count()) === 1, '[empty] last month → neutral "no POS data" state');
    check(s.s5.length === 0 && s.errs.length === 0, '[empty] zero errors');
    await s.ctx.close();
  }
  // integrations off → tab hidden, recipes still fine.
  const before = psql(`select settings::text from restaurants where id='${RID}';`);
  psql(`update restaurants set settings = jsonb_set(settings, '{features,integrations}', 'false') where id='${RID}';`);
  try {
    const s = await session(browser, 'owner', 'he');
    await s.page.goto(`${BASE}/dashboard/recipes`);
    await s.page.waitForSelector('main table', { timeout: 20000 });
    await s.page.waitForTimeout(1500);
    check((await s.page.getByRole('tab', { name: TAB.he }).count()) === 0, '[integrations off] POS tab hidden');
    check(s.s5.length === 0 && s.errs.length === 0, '[integrations off] zero errors');
    await s.ctx.close();
  } finally {
    psql(`update restaurants set settings = $j$${before}$j$::jsonb where id='${RID}';`);
  }
} finally {
  await browser.close();
  if (hadTable) psql(`delete from pos_sales where restaurant_id='${RID}' and item_ref in ('P-101','P-102','P-900','P-103');`);
  else psql(`drop table pos_sales;`);
}
console.log(results.filter((r) => r.startsWith('FAIL')).join('\n') + '\n----');
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
