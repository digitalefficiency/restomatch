/**
 * Layer-2 check for vatAtRisk (flag), against `next start` on a LOCAL demo DB:
 *   he + en × 1366 + 390: the dashboard card next to the leak hero — T3 calm on
 *   the seed as-is, T2 once an October invoice above ₪5,000 lacks an allocation
 *   number (inserted here, removed after); the leak hero does NOT move; the CTA
 *   opens the Hebrew request text; the invoice page carries the badge; axe
 *   color-contrast 0; zero console errors; chef sees no card; flag off → no card.
 *
 *   E2E_BASE_URL=http://localhost:3000 DATABASE_URL=postgres://…localhost…/db \
 *     PW_CHROMIUM_PATH=… pnpm exec tsx scripts/e2e-vat-at-risk.ts
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB_URL = process.env.DATABASE_URL ?? '';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SHOTS = resolve(process.cwd(), '../../docs/client-ready/screenshots');
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) throw new Error('DATABASE_URL must be a LOCAL database');
const sql = postgres(DB_URL, { max: 2 });
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const INV_NO = `E2E-VAT-${Date.now()}`;

let checks = 0;
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  checks += 1;
  console.log(`  ✓ ${msg}`);
}

async function contrast(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return (r.violations as Array<{ nodes: Array<{ target: string[] }> }>).flatMap((v) => v.nodes.map((n) => n.target.join(' ')));
  });
}

async function login(browser: Browser, who: string, locale: 'he' | 'en', width: number) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/login?lang=${locale}`);
  const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(`${who}@kfar-hazeitim.test`);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 120_000 }), form.locator('button[type="submit"]').click()]);
  return { context, page, errors };
}

/**
 * The hero's leak / spend / discrepancy figures. The calm T4 line counting invoices that wait
 * for an order ("ממתינות לשיוך להזמנה") is cut: a new, unmatched invoice rightly joins it.
 */
const heroText = async (page: Page) =>
  (await page.locator('main section').first().innerText())
    .replace(/\s+/g, ' ')
    .replace(/\d+ חשבוניות \([^)]*\) ממתינות לשיוך להזמנה[^.]*\./u, '');

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const [r] = await sql<{ id: string; settings: Record<string, unknown> }[]>`select id, settings from restaurants where name = 'כפר הזיתים' limit 1`;
  const rid = r!.id;
  // A supplier that charges VAT (produce is VAT-exempt → nothing to lose).
  const [sup] = await sql<{ id: string; name: string }[]>`
    select s.id, s.name from suppliers s join restaurants x on x.id = s.restaurant_id
    where s.restaurant_id = ${rid} and coalesce(s.vat_rate, x.vat_rate) > 0 order by s.name limit 1`;
  let invoiceId = '';
  try {
    // 1) The seed as it is: the card is present, in a definite state.
    {
      const { context, page, errors } = await login(browser, 'owner', 'he', 1366);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      const state = await page.getByTestId('vat-at-risk-card').getAttribute('data-state');
      check(state === 'clear' || state === 'at-risk', `card on the seed: ${state}`);
      if (state === 'at-risk') {
        // The demo seed (S1): exactly one invoice, ₪1,123.20 of VAT at risk.
        const card = await page.getByTestId('vat-at-risk-card').innerText();
        check(/1,123/.test(await page.getByTestId('vat-at-risk-total').innerText()), 'seed: ₪1,123.20 of VAT at risk');
        check(/חשבונית אחת/.test(card), 'seed: exactly one invoice at risk');
        check(!/הפסד/.test(card), 'copy speaks of risk, never "הפסד"');
      }
      if (state === 'clear') check(/5,000/.test(await page.getByTestId('vat-at-risk-card').innerText()) && /₪/.test(await page.getByTestId('vat-at-risk-card').innerText()), 'T3 copy names the ₪5,000 threshold');
      check(errors.length === 0, `zero console errors (${errors.join(' | ') || 'none'})`);
      await context.close();
    }

    // 2) One October invoice above ₪5,000 without an allocation number.
    const before = await (async () => {
      const { context, page } = await login(browser, 'owner', 'he', 1366);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      const t = await heroText(page);
      await context.close();
      return t;
    })();
    const seedTotal = await (async () => {
      const { context, page } = await login(browser, 'owner', 'he', 1366);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      const t = (await page.getByTestId('vat-at-risk-total').count()) ? await page.getByTestId('vat-at-risk-total').innerText() : '';
      await context.close();
      return t;
    })();
    const [inv] = await sql<{ id: string }[]>`
      insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, total_excl_vat, vat_amount, total_incl_vat, status, source)
      values (${rid}, ${sup!.id}, ${INV_NO}, now() - interval '12 days', 6240.00, 1123.20, 7363.20, 'parsed', 'photo')
      returning id`;
    invoiceId = inv!.id;

    for (const locale of ['he', 'en'] as const) {
      for (const width of [1366, 390]) {
        console.log(`\n[vatAtRisk] ${locale} @ ${width}`);
        const { context, page, errors } = await login(browser, 'owner', locale, width);
        await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
        const card = page.getByTestId('vat-at-risk-card');
        check((await card.getAttribute('data-state')) === 'at-risk', 'T2: the card flags the invoice');
        const total = await page.getByTestId('vat-at-risk-total').innerText();
        check(total.replace(/\D/g, '') !== seedTotal.replace(/\D/g, ''), `VAT at risk includes the new invoice (${total.replace(/[\u200e\u200f]/g, '')})`);
        check((await card.innerText()).includes(locale === 'he' ? 'בקשו מהספק מספר הקצאה' : 'Ask the supplier for an allocation number'), 'CTA wording');
        if (locale === 'he' && width === 1366) {
          const after = await heroText(page);
          if (after !== before) console.log('    [hero before]', before.slice(0, 400), '\n    [hero after ]', after.slice(0, 400));
          check(after === before, 'the leak hero (leak ₪, spend, % and discrepancy counts) did not move — VAT at risk is never a leak');
        }
        await page.getByTestId('vat-request-cta').click();
        const text = await page.getByTestId('vat-request-text').first().inputValue();
        check(text.includes(INV_NO) && text.includes('מספר הקצאה') && text.includes('כפר הזיתים'), 'CTA opens the Hebrew request text (number, allocation, restaurant)');
        const bad = await contrast(page);
        check(bad.length === 0, `axe color-contrast on the dashboard: ${bad.length} ${bad.join(' | ')}`);
        await card.screenshot({ path: join(SHOTS, `vat-at-risk-card-${locale}-${width}.png`) });

        await page.goto(`${BASE}/dashboard/invoices/${invoiceId}`, { waitUntil: 'networkidle' });
        check(await page.getByTestId('invoice-vat-at-risk').isVisible(), 'invoice page carries the VAT-at-risk badge');
        const badInv = await contrast(page);
        check(badInv.length === 0, `axe color-contrast on the invoice page: ${badInv.length} ${badInv.join(' | ')}`);
        check(errors.length === 0, `zero console errors (${errors.join(' | ') || 'none'})`);
        await context.close();
      }
    }

    // 3) Gates: chef sees no card; flag off → no card, no badge.
    {
      const { context, page } = await login(browser, 'chef', 'he', 390);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      check((await page.getByTestId('vat-at-risk-card').count()) === 0, 'chef: no VAT card');
      await context.close();
    }
    await sql`update restaurants set settings = jsonb_set(settings, '{features,vatAtRisk}', 'false'::jsonb) where id = ${rid}`;
    try {
      const { context, page } = await login(browser, 'owner', 'en', 1366);
      await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
      check((await page.getByTestId('vat-at-risk-card').count()) === 0, 'flag off: no VAT card');
      await page.goto(`${BASE}/dashboard/invoices/${invoiceId}`, { waitUntil: 'networkidle' });
      check((await page.getByTestId('invoice-vat-at-risk').count()) === 0, 'flag off: no invoice badge');
      await context.close();
    } finally {
      await sql`update restaurants set settings = ${sql.json(r!.settings as never)} where id = ${rid}`;
    }
    console.log(`\nPASS (vatAtRisk): ${checks} checks`);
  } finally {
    if (invoiceId) await sql`delete from invoices where id = ${invoiceId}`;
    await browser.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
