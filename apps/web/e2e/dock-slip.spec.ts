import { expect, test, type Page, type Route } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Dock dispute slip (flag dockSlip) on a 390-px phone, real wizard on the dev
 * server. The e2e server has no worker/Redis, so the test plays both of them:
 * the OCR lines (one billed 8% over the PO price, one billed one unit more) and
 * then the matching engine's discrepancies. The slip must show quantities while
 * the engine is still out, then the ENGINE ₪ (never the wizard's estimate).
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Fixture {
  restaurantId: string;
  supplierName: string;
  poId: string;
  lines: Array<{ poLineId: string; productId: string; name: string; qty: number; price: number }>;
}

async function fixture(): Promise<Fixture> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [sup] = await sql<{ id: string; name: string }[]>`
      select id, name from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r!.id} and canonical_name ~ '[א-ת]' order by canonical_name limit 3`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r!.id}, ${sup!.id}, now() + interval '1 hour', 'sent', 'manual', 'e2e-dock-slip') returning id`;
    const lines: Fixture['lines'] = [];
    for (const [i, p] of prods.entries()) {
      const qty = 4 + i;
      const price = 20 + i * 5;
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${qty}, 'ק״ג', ${price}) returning id`;
      lines.push({ poLineId: pl!.id, productId: p.id, name: p.name, qty, price });
    }
    return { restaurantId: r!.id, supplierName: sup!.name, poId: po!.id, lines };
  } finally {
    await sql.end();
  }
}

async function setDockSlip(restaurantId: string, on: boolean) {
  const sql = e2eSql();
  try {
    await sql`
      update restaurants
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,dockSlip}', to_jsonb(${on}::boolean), true)
      where id = ${restaurantId}`;
  } finally {
    await sql.end();
  }
}

async function scanAndProcess(page: Page, poId: string): Promise<string> {
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
  await page.goto(`/dashboard/receiving/${poId}`);
  await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.getByText(/^נשמר · scan-/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^עבד את החשבונית/ }).click();
  await expect.poll(() => invoiceId, { timeout: 30_000 }).not.toBe('');
  return invoiceId;
}


/** Play the OCR worker: line a billed 8% over the PO price, line b one unit more, line c as ordered. */
async function writeOcrWithDifferences(invoiceId: string, f: Fixture) {
  const [a, b, c] = f.lines;
  const sql = e2eSql();
  try {
    for (const l of [
      { p: a!, qty: a!.qty, price: Math.round(a!.price * 108) / 100 },
      { p: b!, qty: b!.qty + 1, price: b!.price },
      { p: c!, qty: c!.qty, price: c!.price },
    ]) {
      await sql`insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
                values (${invoiceId}, ${l.p.productId}, ${l.p.name}, ${l.qty}, 'ק״ג', ${l.price}, ${Math.round(l.qty * l.price * 100) / 100}, 0.97)`;
    }
    await sql`update invoices set status = 'parsed', ocr_confidence = 0.96, invoice_number = ${`DS-${invoiceId.slice(0, 6)}`}, total_incl_vat = 999 where id = ${invoiceId}`;
  } finally {
    await sql.end();
  }
}

/** Review → adjust ("= order" on every difference) → close the receipt. */
async function closeReceipt(page: Page) {
  await page.getByTestId('continue-adjust').click();
  for (const card of await page.locator('.adjust-card').all()) {
    const btn = card.getByRole('button', { name: /^= הזמנה/ });
    if (await btn.isVisible()) await btn.click();
  }
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
});

test('flag off (a real boolean false): a receipt WITH differences shows no slip and never asks for one', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await fixture();
  await setDockSlip(f.restaurantId, false);
  const slipCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('receiving.dockSlip')) slipCalls.push(r.url());
  });
  try {
    const flag = await (async () => {
      const sql = e2eSql();
      try {
        const [row] = await sql<{ v: unknown }[]>`select settings->'features'->'dockSlip' as v from restaurants where id = ${f.restaurantId}`;
        return row!.v;
      } finally {
        await sql.end();
      }
    })();
    expect(flag).toBe(false); // a JSON boolean, not the string "false"
    const invoiceId = await scanAndProcess(page, f.poId);
    await writeOcrWithDifferences(invoiceId, f);
    await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('continue-adjust')).toBeVisible();
    await expect(page.getByTestId('open-dock-slip')).toHaveCount(0);
    await closeReceipt(page);
    await expect(page.getByTestId('dock-slip')).toHaveCount(0);
    expect(slipCalls).toEqual([]);
  } finally {
    await setDockSlip(f.restaurantId, true);
  }
});

test('390 px: quantities on the review; the engine ₪ only after the receipt is closed and re-matched', async ({ page }) => {
  test.setTimeout(180_000);
  const f = await fixture();
  await setDockSlip(f.restaurantId, true);
  const invoiceId = await scanAndProcess(page, f.poId);
  const [a, b] = f.lines;
  const overPrice = Math.round(a!.price * 108) / 100;
  await writeOcrWithDifferences(invoiceId, f);

  // Review (receipt still open): header + quantities, never ₪ — not even in the WhatsApp text.
  await expect(page.getByRole('heading', { name: 'תוצאת ההצלבה' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('open-dock-slip').click();
  const review = page.getByTestId('dock-slip');
  await expect(review).toBeVisible();
  await expect(review.getByTestId('dock-slip-supplier')).toHaveText(f.supplierName);
  await expect(review.locator('dd').getByText(`DS-${invoiceId.slice(0, 6)}`)).toBeVisible();
  await expect(review.getByTestId('dock-slip-after-close')).toBeVisible();
  await expect(review.getByTestId('dock-slip-computing')).toHaveCount(0);
  await expect(review.getByTestId('dock-slip-amount')).toHaveCount(0);
  await expect(review.getByTestId('dock-slip-total')).toHaveCount(0);
  await expect(review.getByText(/מחיר: בהזמנה/)).toBeVisible();
  const reviewText = (await review.getByTestId('dock-slip-copy').getAttribute('data-slip-text'))!;
  expect(reviewText).toContain('תעודת חריגה');
  // Prices are quoted, but no "— ₪ at stake" per line and no total to claim.
  expect(reviewText).not.toMatch(/—\s*[\d₪]/);
  expect(reviewText).not.toContain('לדרישת זיכוי');
  const href = await review.getByTestId('dock-slip-whatsapp').getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\//);
  expect(decodeURIComponent(href!.split('text=')[1]!)).toContain(f.supplierName);
  await review.screenshot({ path: test.info().outputPath('dock-slip-review-390.png') });

  // Close the receipt: the slip waits for the re-match (a pre-count run would not count).
  await closeReceipt(page);
  const slip = page.getByTestId('dock-slip');
  await expect(slip).toBeVisible();
  await expect(slip.getByTestId('dock-slip-computing')).toBeVisible();
  await expect(slip.getByTestId('dock-slip-amount')).toHaveCount(0);

  // Play the worker's re-match after the count: a run + two findings (price, qty).
  const priceDelta = Math.round((overPrice - a!.price) * a!.qty * 100) / 100;
  const sql2 = e2eSql();
  try {
    const [gr] = await sql2<{ id: string }[]>`select id from goods_receipts where po_id = ${f.poId} limit 1`;
    const [run] = await sql2<{ id: string }[]>`
      insert into match_runs (restaurant_id, po_id, gr_id, invoice_id, overall_status, run_at)
      values (${f.restaurantId}, ${f.poId}, ${gr!.id}, ${invoiceId}, 'major', now() + interval '1 second') returning id`;
    await sql2`insert into discrepancies (match_run_id, restaurant_id, type, severity, product_id, po_line_id, expected_value, actual_value, delta_amount)
               values (${run!.id}, ${f.restaurantId}, 'PRICE_HIGHER', 'warn', ${a!.productId}, ${a!.poLineId}, ${a!.price}, ${overPrice}, ${priceDelta}),
                      (${run!.id}, ${f.restaurantId}, 'QTY_OVER', 'warn', ${b!.productId}, ${b!.poLineId}, ${b!.qty}, ${b!.qty + 1}, ${b!.price})`;
  } finally {
    await sql2.end();
  }
  const expectedTotal = Math.round((priceDelta + b!.price) * 100) / 100;
  await expect(slip.getByTestId('dock-slip-amount')).toHaveCount(2, { timeout: 30_000 });
  await expect(slip.getByTestId('dock-slip-computing')).toHaveCount(0);
  const totalText = (await slip.getByTestId('dock-slip-total').innerText()).replace(/[^\d.]/g, '');
  expect(Number(totalText)).toBe(expectedTotal);
  expect(await slip.getByTestId('dock-slip-copy').getAttribute('data-slip-text')).toMatch(/₪/);
  // Phone-first: nothing overflows the 390-px viewport.
  const box = (await slip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('dock-slip-confirmed-390.png'), fullPage: true });
});
