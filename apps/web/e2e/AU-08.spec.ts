import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * AU-08 (A13) · allocation-number guard and chase — the VAT card on the finance home.
 *
 *   - bookkeeper: the card's request panel shows one block per supplier with its
 *     stage line, the server draft, a wa.me link prefilled with that draft, and
 *     "סמנו כנשלח" → a 10 s "סומן כנשלח" toast with undo; only after the window
 *     closes is the request recorded (one vat.allocation_requested audit row), and
 *     the stage turns to "נשלחה בקשה היום" with a reminder CTA;
 *   - undo inside the window records nothing;
 *   - manager: sees the draft, never the mark button (writes are owner + bookkeeper);
 *   - axe (serious/critical) on the open card in he and en; phone 390 without
 *     horizontal overflow.
 *
 * The spec makes its own supplier (with a WhatsApp number) and one at-risk invoice
 * (₪6,000 before VAT, no allocation number, dated 5 Israel days ago), so it never
 * depends on the demo seed's rows and leaves them untouched.
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SUPPLIER = 'AU-08 ספק בדיקה';
const INVOICE_NO = 'AU08-E2E-1';
const MARK_WINDOW_MS = 10_000;

let restaurantId = '';
let supplierId = '';
let invoiceId = '';

function israelDayOffset(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function requestCount(): Promise<number> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where restaurant_id = ${restaurantId} and action = 'vat.allocation_requested' and entity_id = ${invoiceId}`;
    return r?.n ?? 0;
  } finally {
    await sql.end();
  }
}

/**
 * The e2e DB keeps the magic-link throttle (3 per mailbox per 15 min, lib/rateLimit.ts) across
 * tests; this spec signs the bookkeeper in more than 3 times, so it clears that counter first —
 * the same fixture step helpers.ts takes for the `login:%` keys.
 */
async function signIn(page: Page, email: string) {
  const sql = e2eSql();
  try {
    await sql`delete from rate_limit_counters where key like ${'magiclink:%'}`;
  } finally {
    await sql.end();
  }
  await loginViaMagicLink(page, email);
}

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function openSupplierBlock(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'load' });
  const card = page.getByTestId('vat-at-risk-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('vat-request-cta').click();
  const block = card.getByTestId('vat-request-supplier').filter({ hasText: SUPPLIER });
  await expect(block).toBeVisible();
  // The server draft has arrived (the text area carries the invoice number).
  await expect(block.getByTestId('vat-request-text')).toHaveValue(new RegExp(INVOICE_NO));
  return { card, block };
}

async function axeSerious(page: Page, selector: string): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (sel) => {
    const w = window as unknown as {
      axe: { run: (ctx: Element, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
    };
    const el = document.querySelector(sel);
    if (!el) return ['missing-target'];
    const r = await w.axe.run(el, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  }, selector);
}

test.describe('AU-08 · VAT card chase', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const sql = e2eSql();
    try {
      const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
      restaurantId = r!.id;
      const [s] = await sql<{ id: string }[]>`
        insert into suppliers (restaurant_id, name, contact_whatsapp)
        values (${restaurantId}, ${SUPPLIER}, '054-1234567') returning id`;
      supplierId = s!.id;
      const day = israelDayOffset(-5);
      const [i] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, total_excl_vat, vat_amount, status, source)
        values (${restaurantId}, ${supplierId}, ${INVOICE_NO}, ${`${day}T10:00:00+02:00`}, '6000.00', '1080.00', 'parsed', 'photo')
        returning id`;
      invoiceId = i!.id;
    } finally {
      await sql.end();
    }
  });

  test.afterAll(async () => {
    const sql = e2eSql();
    try {
      // audit_log is append-only; the fixture invoice and supplier go, their audit rows stay.
      if (invoiceId) await sql`delete from invoices where id = ${invoiceId}`;
      if (supplierId) await sql`delete from suppliers where id = ${supplierId}`;
    } finally {
      await sql.end();
    }
  });

  test('bookkeeper: stage line, prefilled wa.me, mark-sent with undo, then recorded once', async ({ page }) => {
    test.setTimeout(120_000);
    await setLocale(page, 'he');
    await signIn(page, 'bookkeeper@kfar-hazeitim.test');
    const { block } = await openSupplierBlock(page);

    await expect(block.getByTestId('vat-request-stage')).toHaveText('טרם נשלחה בקשה');
    const wa = block.getByTestId('vat-request-wa');
    await expect(wa).toHaveText(/בקשו מספר הקצאה/);
    const href = (await wa.getAttribute('href')) ?? '';
    expect(href).toMatch(/^https:\/\/wa\.me\/972541234567\?text=/);
    const text = decodeURIComponent(href.split('text=')[1] ?? '');
    expect(text).toContain(INVOICE_NO);
    expect(text).toContain('לפני מע״מ');
    for (const banned of ['דרישה', 'תביעה', 'מחלוקת', 'חוב', 'באיחור', 'דליפה']) expect(text).not.toContain(banned);

    // Undo inside the window → nothing is recorded.
    await block.getByTestId('vat-request-mark').click();
    await page.getByRole('button', { name: 'ביטול' }).last().click();
    await page.waitForTimeout(MARK_WINDOW_MS + 1_500);
    expect(await requestCount()).toBe(0);

    // Let the window close → exactly one audit row, and the stage moves on.
    await block.getByTestId('vat-request-mark').click();
    await expect(page.getByText('סומן כנשלח').first()).toBeVisible();
    await expect.poll(requestCount, { timeout: MARK_WINDOW_MS + 15_000 }).toBe(1);

    const again = await openSupplierBlock(page);
    await expect(again.block.getByTestId('vat-request-stage')).toHaveText('נשלחה בקשה היום');
    await expect(again.block.getByTestId('vat-request-wa')).toHaveText(/שלחו תזכורת/);
    await expect(again.block.getByTestId('vat-request-text')).toHaveValue(/תזכורת קטנה/);
  });

  test('manager: sees the draft, never the mark button', async ({ page }) => {
    await setLocale(page, 'he');
    await signIn(page, 'manager@kfar-hazeitim.test');
    const { block } = await openSupplierBlock(page);
    await expect(block.getByTestId('vat-request-wa')).toBeVisible();
    await expect(block.getByTestId('vat-request-mark')).toHaveCount(0);
  });

  for (const locale of ['he', 'en'] as const) {
    test(`axe: the open VAT card has no serious/critical issue (${locale})`, async ({ page }) => {
      await setLocale(page, locale);
      await signIn(page, 'bookkeeper@kfar-hazeitim.test');
      await openSupplierBlock(page);
      expect(await axeSerious(page, '[data-testid="vat-at-risk-card"]')).toEqual([]);
    });
  }

  test('phone 390: the open card fits the width', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'he-IL' });
    const page = await context.newPage();
    await setLocale(page, 'he');
    await signIn(page, 'bookkeeper@kfar-hazeitim.test');
    const { card } = await openSupplierBlock(page);
    const box = await card.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
