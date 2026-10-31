import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * Ordering: a delivered order reads "received" in the orders list.
 *
 * The stored PO status stays 'sent' after a receipt (buildMatchInput matches
 * invoices against sent/confirmed/partial POs), so the list derives the
 * displayed status from the PO's latest goods receipt. This walks the real
 * flow: open a fresh PO in the Delivery Check → "no invoice right now" →
 * "everything arrived as ordered" → the blind spot check (W1-06, owner
 * decision 20) counts both lines → the receipt closes → /dashboard/orders shows "התקבלה" / "Received" for it, in Hebrew
 * and English, at desktop and phone width. A receipt is not an invoice, so the
 * dashboard's leak ₪ must not move.
 */

test.describe.configure({ mode: 'serial' });
test.use({ storageState: OWNER_STATE });

type Locale = 'he' | 'en';
const VIEWPORTS = [
  { name: '1366', use: { viewport: { width: 1366, height: 900 } } },
  { name: '390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const;
const RECEIVED_LABEL: Record<Locale, string> = { he: 'התקבלה', en: 'Received' };
const RECEIVED_FILTER: Record<Locale, string> = { he: 'התקבלו', en: 'Received' };
const CANCEL_LABEL: Record<Locale, string> = { he: 'ביטול הזמנה', en: 'Cancel order' };

let poId = '';
/** po_line id → qty ordered, so the blind spot check can be answered with a true count. */
const lineQty = new Map<string, number>();

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r.id} and canonical_name ~ '[א-ת]'
      order by canonical_name limit 2`;
    if (!sup || prods.length < 2) throw new Error('seed needs a supplier and 2 Hebrew products');
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r.id}, ${sup.id}, now() + interval '1 hour', 'sent', 'manual', 'e2e-orders-received')
      returning id`;
    for (const [i, p] of prods.entries()) {
      const [line] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${3 + i}, 'ק״ג', ${12 + i * 4})
        returning id`;
      lineQty.set(line!.id, 3 + i);
    }
    poId = po!.id;
  } finally {
    await sql.end();
  }
});

async function setLocale(page: Page, locale: Locale) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function heroLeak(page: Page): Promise<string> {
  await page.goto('/dashboard');
  const hero = page.locator('section[aria-labelledby="leak-hero-label"]');
  return (await hero.locator('p.font-mono').first().innerText()).trim();
}

/** The status badge of this PO's row: the table row on desktop, the card on phone. */
function rowStatus(page: Page) {
  return page
    .locator('tr, li')
    .filter({ has: page.locator(`a[href="/dashboard/orders/${poId}"]`) })
    .locator('[data-testid="order-status"]')
    .filter({ visible: true });
}

test('open PO → receive "= order" → close → the orders list says received', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await setLocale(page, 'he');
  const leakBefore = await heroLeak(page);

  // Before: sent, nothing received yet.
  await page.goto('/dashboard/orders');
  await expect(rowStatus(page)).toHaveAttribute('data-status', 'sent');

  await page.goto(`/dashboard/receiving/${poId}`);
  // W1-06 Delivery Check: no invoice right now → everything arrived as ordered →
  // the blind spot check (never shows the order) → the receipt closes.
  await page.getByTestId('scan-no-invoice').click();
  await expect(page.getByTestId('delivery-check')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('all-arrived').click();
  const panel = page.getByTestId('spot-check');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('spot-line');
  for (let i = 0; i < (await rows.count()); i += 1) {
    const id = (await rows.nth(i).getAttribute('data-key'))!.replace(/^po-/, '');
    await rows.nth(i).getByTestId('spot-qty').fill(String(lineQty.get(id)));
  }
  await panel.getByTestId('spot-confirm').click();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });

  expect(await heroLeak(page), 'a goods receipt does not move the leak ₪').toBe(leakBefore);
  expect(errors, errors.join('\n')).toEqual([]);
});

for (const vp of VIEWPORTS) {
  test.describe(`orders list after receipt @${vp.name}`, () => {
    test.use(vp.use);
    for (const locale of ['he', 'en'] as const) {
      test(`${locale}: the received PO reads "${RECEIVED_LABEL[locale]}", also under its filter`, async ({ page }) => {
        const errors = collectPageErrors(page);
        await setLocale(page, locale);
        await page.goto('/dashboard/orders');
        const badge = rowStatus(page);
        await expect(badge).toHaveAttribute('data-status', 'received');
        await expect(badge).toHaveText(RECEIVED_LABEL[locale]);

        await page.getByRole('button', { name: RECEIVED_FILTER[locale], exact: true }).click();
        await expect(rowStatus(page)).toHaveAttribute('data-status', 'received');

        await page.goto(`/dashboard/orders/${poId}`);
        await expect(page.locator('[data-testid="order-status"]').filter({ visible: true }).first()).toHaveAttribute(
          'data-status',
          'received',
        );
        // A received order is history: no cancel (the server refuses it too).
        await expect(page.getByRole('button', { name: CANCEL_LABEL[locale] })).toHaveCount(0);
        expect(errors, errors.join('\n')).toEqual([]);
      });
    }
  });
}
