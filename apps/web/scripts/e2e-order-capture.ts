/**
 * Layer-2 check for orderCapture (flag), against `next start` on a LOCAL demo DB:
 *   he + en × 1366 + 390: orders page entry → paste a WhatsApp order → draft
 *   (supplier recognised, catalog lines matched, prices) → one-tap confirm →
 *   a normal sent PO with nothing transmitted; the unknown-supplier pick flow;
 *   a role without orders, and the flag off, see no capture screen (404 UI);
 *   the PWA share target lands on the pre-filled screen. Zero console errors.
 *
 *   E2E_BASE_URL=http://localhost:3000 DATABASE_URL=postgres://…localhost…/db \
 *     PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/e2e-order-capture.ts
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';
import { hashIngestToken, signMeta } from '@restomatch/ingest';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB_URL = process.env.DATABASE_URL ?? '';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SHOTS = resolve(process.cwd(), '../../docs/client-ready/screenshots');
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) throw new Error('DATABASE_URL must be a LOCAL database');
const sql = postgres(DB_URL, { max: 2 });

let checks = 0;
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  checks += 1;
  console.log(`  ✓ ${msg}`);
}

type Locale = 'he' | 'en';
const SUPPLIER = 'ירקות השרון';

function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

async function login(browser: Browser, who: string, locale: Locale, width: number) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    ...(width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  // Consent already given (the banner would cover the bottom buttons at 390).
  await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: BASE }]);
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(`${BASE}/login?lang=${locale}`);
  const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(`${who}@kfar-hazeitim.test`);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 120_000 }), form.locator('button[type="submit"]').click()]);
  return { context, page, errors };
}

async function rid(): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from restaurants where name = 'כפר הזיתים' limit 1`;
  return r!.id;
}

async function happyPath(browser: Browser, locale: Locale, width: number) {
  console.log(`\n[orderCapture] ${locale} @ ${width}`);
  const { context, page, errors } = await login(browser, 'owner', locale, width);
  // The English UI shows the supplier's English name when it has one.
  const [sup] = await sql<{ name_en: string | null }[]>`select name_en from suppliers where name = ${SUPPLIER} limit 1`;
  const shown = locale === 'en' && sup?.name_en ? sup.name_en : SUPPLIER;
  await page.goto(`${BASE}/dashboard/orders`, { waitUntil: 'networkidle' });
  const entry = page.getByTestId('order-capture-entry');
  check(await entry.isVisible(), 'orders page shows the capture entry');
  await Promise.all([page.waitForURL(/\/dashboard\/orders\/capture/), entry.click()]);
  const stamp = `${locale}-${width}-${Date.now()}`;
  const text = [`ספק: ${SUPPLIER}`, 'שלום, הזמנה למחר:', '10 ק"ג מלפפונים', '3 צרורות פטרוזיליה', '2 ארגזים חסה 40 ₪', `בדיקה ${stamp}`].join('\n');
  await page.getByTestId('capture-text').fill(text);
  await page.getByTestId('capture-submit').click();
  const draft = page.getByTestId('capture-draft');
  await draft.waitFor({ timeout: 30_000 }).catch(async (err: unknown) => {
    console.error((await page.locator('main').innerText()).slice(0, 1500), errors);
    throw err;
  });
  await page.getByTestId('capture-lines').locator('li').first().waitFor();
  const lines = await page.getByTestId('capture-lines').locator('li').count();
  check(lines === 3, `draft shows 3 lines (got ${lines})`);
  const draftText = await draft.innerText();
  check(draftText.includes(shown), 'draft names the recognised supplier');
  check(/מותאם|Matched/.test(draftText) && /פריט חדש|New item/.test(draftText), 'catalog-matched and new items are told apart');
  check(/₪/.test(draftText), 'prices shown in ₪');
  await page.screenshot({ path: join(SHOTS, `order-capture-draft-${locale}-${width}.png`), fullPage: true });

  const [po] = await sql<{ id: string; status: string; source: string }[]>`
    select id, status, source from purchase_orders where notes like ${`%${stamp}%`} limit 1`;
  check(po?.status === 'draft' && po.source === 'manual', 'a DRAFT purchase order exists in the DB');

  await page.getByTestId('capture-confirm').click();
  await page.getByTestId('capture-confirmed').waitFor({ timeout: 30_000 });
  const [after] = await sql<{ status: string; sent_channel: string | null }[]>`
    select status, sent_channel from purchase_orders where id = ${po!.id}`;
  check(after?.status === 'sent' && after.sent_channel === null, 'one tap: draft → sent, transmitted on no channel');
  const [outbox] = await sql<{ n: number }[]>`select count(*)::int as n from notifications_outbox where related_entity_id = ${po!.id}`;
  check(outbox?.n === 0, 'nothing queued to the supplier');
  await page.screenshot({ path: join(SHOTS, `order-capture-confirmed-${locale}-${width}.png`), fullPage: true });

  if (width < 500) {
    // Unknown supplier → pick → draft.
    await page.goto(`${BASE}/dashboard/orders/capture`, { waitUntil: 'networkidle' });
    await page.getByTestId('capture-text').fill(`4 ק״ג בצל יבש\n2 ק״ג מלפפונים\n${stamp}-pick`);
    await page.getByTestId('capture-submit').click();
    await page.getByTestId('capture-pick-supplier').waitFor({ timeout: 30_000 });
    await page.getByLabel(shown, { exact: true }).check();
    await page.screenshot({ path: join(SHOTS, `order-capture-pick-${locale}-${width}.png`), fullPage: true });
    await page.getByTestId('capture-pick-continue').click();
    await page.getByTestId('capture-lines').locator('li').first().waitFor({ timeout: 30_000 });
    check((await page.getByTestId('capture-draft').innerText()).includes(shown), 'picked supplier → draft');

    // Share target (installed PWA) → pre-filled capture screen.
    await page.goto(`${BASE}/dashboard/receiving/share?text=${encodeURIComponent('5 ק״ג עגבניות שרי')}`, { waitUntil: 'networkidle' });
    check(page.url().includes('/dashboard/orders/capture'), 'share target redirects to capture');
    check((await page.getByTestId('capture-text').inputValue()).includes('עגבניות שרי'), 'shared text is pre-filled');
  }

  check(errors.length === 0, `zero console errors (${errors.join(' | ') || 'none'})`);
  await context.close();
}

async function hiddenWhenNotAllowed(browser: Browser, restaurantId: string) {
  console.log('\n[orderCapture] role + flag gates');
  {
    const { context, page, errors } = await login(browser, 'receiver', 'he', 1366);
    await page.goto(`${BASE}/dashboard/orders/capture`, { waitUntil: 'networkidle' });
    check((await page.getByTestId('capture-text').count()) === 0, 'receiver: no capture screen');
    check(errors.filter((e) => !/404/.test(e)).length === 0, 'receiver: no console errors besides the 404');
    await context.close();
  }
  const [row] = await sql<{ settings: Record<string, unknown> }[]>`select settings from restaurants where id = ${restaurantId}`;
  const settings = row!.settings;
  try {
    await sql`update restaurants set settings = jsonb_set(settings, '{features,orderCapture}', 'false'::jsonb) where id = ${restaurantId}`;
    const { context, page } = await login(browser, 'owner', 'en', 1366);
    await page.goto(`${BASE}/dashboard/orders`, { waitUntil: 'networkidle' });
    check((await page.getByTestId('order-capture-entry').count()) === 0, 'flag off: no entry on the orders page');
    await page.goto(`${BASE}/dashboard/orders/capture`, { waitUntil: 'networkidle' });
    check((await page.getByTestId('capture-text').count()) === 0, 'flag off: no capture screen');
    await context.close();
  } finally {
    await sql`update restaurants set settings = ${sql.json(settings as never)} where id = ${restaurantId}`;
  }
}

/** A forwarded order sent to the restaurant's WhatsApp ingest number → a draft PO, linked from the inbox. */
async function webhookOrder(browser: Browser, restaurantId: string) {
  console.log('\n[orderCapture] WhatsApp forward → draft (webhook)');
  const [ch] = await sql<{ id: string; token_hash: string; phone_number_id: string | null }[]>`
    select id, token_hash, phone_number_id from ingest_channels where restaurant_id = ${restaurantId} and kind = 'whatsapp' and active`;
  check(ch, 'demo restaurant has a live WhatsApp channel (from ingest-simulate)');
  // A known token for this run only; the original hash is restored after.
  const token = `wa_${'e2e0'.repeat(8)}`;
  const owner = '972541234567';
  await sql`update ingest_channels set token_hash = ${hashIngestToken(token)} where id = ${ch!.id}`;
  await sql`insert into ingest_senders (restaurant_id, kind, sender, label) values (${restaurantId}, 'whatsapp', ${owner}, 'e2e owner') on conflict do nothing`;
  try {
    const stamp = Date.now();
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: ch!.phone_number_id ?? '1000000001' },
        messages: [{ from: owner, id: `wamid.e2e.order.${stamp}`, timestamp: String(Math.floor(stamp / 1000)), type: 'text',
          text: { body: `הזמנה ל${SUPPLIER} למחר:\n8 ק"ג מלפפונים\n4 צרורות כוסברה` } }],
      } }] }],
    });
    const res = await fetch(`${BASE}/api/ingest/whatsapp/${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signMeta(body, process.env.WHATSAPP_APP_SECRET ?? '') },
      body,
    });
    check(res.status === 200, `signed WhatsApp text → HTTP ${res.status}`);
    const [po] = await sql<{ id: string; status: string; source: string }[]>`
      select id, status, source from purchase_orders where restaurant_id = ${restaurantId} and source = 'whatsapp'
      and notes like '%4 צרורות כוסברה%' order by created_at desc limit 1`;
    check(po?.status === 'draft', 'a whatsapp DRAFT purchase order was captured');

    const { context, page, errors } = await login(browser, 'owner', 'he', 390);
    await page.goto(`${BASE}/dashboard/inbox`, { waitUntil: 'networkidle' });
    const link = page.getByTestId('ingest-order').first().getByRole('link');
    check(await link.isVisible(), 'inbox shows the forwarded order with a link to its draft');
    await page.screenshot({ path: join(SHOTS, 'order-capture-inbox-he-390.png'), fullPage: true });
    await Promise.all([page.waitForURL(new RegExp(`/dashboard/orders/${po!.id}`)), link.click()]);
    check(errors.length === 0, `zero console errors (${errors.join(' | ') || 'none'})`);
    await context.close();
  } finally {
    await sql`update ingest_channels set token_hash = ${ch!.token_hash} where id = ${ch!.id}`;
    await sql`delete from ingest_senders where restaurant_id = ${restaurantId} and sender = ${owner} and label = 'e2e owner'`;
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  try {
    for (const locale of ['he', 'en'] as const) {
      for (const width of [1366, 390]) await happyPath(browser, locale, width);
    }
    await webhookOrder(browser, await rid());
    await hiddenWhenNotAllowed(browser, await rid());
    console.log(`\nPASS (orderCapture): ${checks} checks`);
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
