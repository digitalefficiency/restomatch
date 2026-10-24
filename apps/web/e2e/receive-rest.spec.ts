import { expect, test, type Route } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * "Receive the rest" (flag receiptReopen) on a 390-px phone. An order whose
 * receipt closed partial (2 of 4 kg of one item; the other item complete): the
 * read-only receipt offers "קבלת יתרת ההזמנה", the receiver scans the second
 * invoice, counts only what arrived now, and the receipt holds the running
 * total. The e2e server has no worker, so the test plays the OCR.
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Fixture {
  restaurantId: string;
  poId: string;
  short: { poLineId: string; grLineId: string; productId: string; name: string; price: number };
  done: { poLineId: string; grLineId: string };
}

/** An order of 4 + 5 kg, received 2 + 5: its receipt closed partial. */
async function partialReceipt(): Promise<Fixture> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r!.id} and canonical_name ~ '[א-ת]' order by canonical_name limit 2`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r!.id}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', 'e2e-receive-rest') returning id`;
    const [gr] = await sql<{ id: string }[]>`
      insert into goods_receipts (restaurant_id, po_id, status) values (${r!.id}, ${po!.id}, 'partial') returning id`;
    const out: Array<{ poLineId: string; grLineId: string; productId: string; name: string; price: number }> = [];
    for (const [i, p] of prods.entries()) {
      const [ordered, received, price] = i === 0 ? [4, 2, 20] : [5, 5, 30];
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${ordered}, 'ק״ג', ${price}) returning id`;
      const [gl] = await sql<{ id: string }[]>`
        insert into gr_lines (gr_id, po_line_id, product_id, qty_received, qty_rejected)
        values (${gr!.id}, ${pl!.id}, ${p.id}, ${received}, 0) returning id`;
      out.push({ poLineId: pl!.id, grLineId: gl!.id, productId: p.id, name: p.name, price });
    }
    return { restaurantId: r!.id, poId: po!.id, short: out[0]!, done: out[1]! };
  } finally {
    await sql.end();
  }
}

async function setReceiptReopen(restaurantId: string, on: boolean) {
  const sql = e2eSql();
  try {
    await sql`
      update restaurants
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,receiptReopen}', to_jsonb(${on}::boolean), true)
      where id = ${restaurantId}`;
  } finally {
    await sql.end();
  }
}

async function receipt(poId: string) {
  const sql = e2eSql();
  try {
    const [gr] = await sql<{ status: string }[]>`select status from goods_receipts where po_id = ${poId}`;
    const lines = await sql<{ poLineId: string; qty: string }[]>`
      select g.po_line_id as "poLineId", g.qty_received::text as qty
      from gr_lines g join goods_receipts r on r.id = g.gr_id where r.po_id = ${poId}`;
    return { status: gr!.status, qty: Object.fromEntries(lines.map((l) => [l.poLineId, Number(l.qty)])) };
  } finally {
    await sql.end();
  }
}

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
});

test('flag off: a partial receipt stays read-only, no "receive the rest"', async ({ page }) => {
  const f = await partialReceipt();
  await setReceiptReopen(f.restaurantId, false);
  try {
    await page.goto(`/dashboard/receiving/${f.poId}`);
    await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('receive-rest-action')).toHaveCount(0);
  } finally {
    await setReceiptReopen(f.restaurantId, true);
  }
});

test('the rest arrives: count only this delivery, the receipt holds the running total and closes completed', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await partialReceipt();
  await setReceiptReopen(f.restaurantId, true);

  await page.goto(`/dashboard/receiving/${f.poId}`);
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 30_000 });
  const action = page.getByTestId('receive-rest-action');
  await expect(action).toHaveText(/קבלת יתרת ההזמנה/);
  const box = (await action.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44); // a thumb target at 390 px
  await action.click();

  // Reopened: the scan step, with the follow-up notice.
  await expect(page.getByTestId('receive-rest-notice')).toBeVisible({ timeout: 30_000 });
  expect((await receipt(f.poId)).status).toBe('pending');

  let invoiceId = '';
  await page.route('**/api/trpc/receiving.registerInvoice**', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Array<{ result?: { data?: { json?: Record<string, unknown> } } }>;
    const json = body[0]?.result?.data?.json;
    if (json) {
      invoiceId = String(json.invoiceId);
      json.ocrQueued = true; // the test is the worker
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByText(/^נשמר · scan-/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^עבד את החשבונית/ }).click();
  await expect.poll(() => invoiceId, { timeout: 30_000 }).not.toBe('');

  // The second invoice bills the rest: 2 kg of the short item.
  const sql = e2eSql();
  try {
    await sql`insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
              values (${invoiceId}, ${f.short.productId}, ${f.short.name}, 2, 'ק״ג', ${f.short.price}, ${2 * f.short.price}, 0.97)`;
    await sql`update invoices set status = 'matched', ocr_confidence = 0.96, invoice_number = ${`RR-${invoiceId.slice(0, 6)}`} where id = ${invoiceId}`;
  } finally {
    await sql.end();
  }

  // The review holds only what is still owed — the complete item is not asked again.
  await expect(page.getByTestId('continue-adjust')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('receive-rest-notice')).toBeVisible();
  await page.getByTestId('continue-adjust').click();
  await expect(page.locator('.adjust-card')).toHaveCount(1);
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });

  // Running total: 2 already + 2 now; the complete line untouched.
  const after = await receipt(f.poId);
  expect(after.qty[f.short.poLineId]).toBe(4);
  expect(after.qty[f.done.poLineId]).toBe(5);
  expect(after.status).toBe('completed');

  // Completed is final: reopening the PO shows it read-only, with no second "rest".
  await page.reload();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('receive-rest-action')).toHaveCount(0);
  await expect(page.getByTestId('close-receipt')).toHaveCount(0);
});
