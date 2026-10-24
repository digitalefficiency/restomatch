import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * Receiving review on DESKTOP, end to end through the real wizard:
 * upload (dev local scan storage) → registerInvoice → poll getInvoice → review.
 *
 * The e2e web server runs without Redis/worker (CI has none), so the test plays
 * the worker: `registerInvoice` is reported to the browser as queued (the only
 * response that is touched), and the test writes the OCR result — the dev
 * stub's shape: PO lines, one billed above the agreed price, one billed one
 * unit more — straight into the e2e DB at a moment it chooses. That also makes
 * "OCR finishes late" deterministic.
 */

test.use({ storageState: OWNER_STATE, viewport: { width: 1280, height: 860 } });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Po {
  poId: string;
  lines: Array<{ poLineId: string; productId: string; name: string; qty: number; price: number }>;
}

async function freshPo(tag: string): Promise<Po> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('demo restaurant missing from the e2e DB');
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r.id} order by name limit 1`;
    const prods = await sql<{ id: string; name: string }[]>`
      select id, canonical_name as name from products
      where restaurant_id = ${r.id} and canonical_name ~ '[א-ת]'
      order by canonical_name limit 4`;
    if (!sup || prods.length < 4) throw new Error('seed needs a supplier and 4 Hebrew products');
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, expected_delivery_at, status, source, notes)
      values (${r.id}, ${sup.id}, now() + interval '1 hour', 'sent', 'manual', ${`e2e-review-${tag}`})
      returning id`;
    const lines: Po['lines'] = [];
    for (const [i, p] of prods.entries()) {
      const qty = 2 + i;
      const price = 10 + i * 5;
      const [pl] = await sql<{ id: string }[]>`
        insert into po_lines (po_id, product_id, raw_description, qty_ordered, unit, unit_price_expected)
        values (${po!.id}, ${p.id}, ${p.name}, ${qty}, 'ק״ג', ${price}) returning id`;
      lines.push({ poLineId: pl!.id, productId: p.id, name: p.name, qty, price });
    }
    return { poId: po!.id, lines };
  } finally {
    await sql.end();
  }
}

/** What the worker writes when OCR finishes. */
async function finishOcr(
  invoiceId: string,
  lines: Array<{ productId: string | null; name: string; qty: number; price: number }>,
) {
  const sql = e2eSql();
  try {
    for (const l of lines) {
      await sql`
        insert into invoice_lines (invoice_id, product_id, raw_description, qty_billed, unit, unit_price_billed, line_total, ocr_confidence_line)
        values (${invoiceId}, ${l.productId}, ${l.name}, ${l.qty}, 'ק״ג', ${l.price}, ${Math.round(l.qty * l.price * 100) / 100}, 0.97)`;
    }
    await sql`
      update invoices set status = 'parsed', ocr_confidence = 0.96,
        invoice_number = ${`E2E-${invoiceId.slice(0, 8)}`}
      where id = ${invoiceId}`;
  } finally {
    await sql.end();
  }
}

/** Upload a scan, report OCR as queued, tap Process. Resolves with the invoice id. */
async function scanAndProcess(page: Page, poId: string): Promise<string> {
  let invoiceId = '';
  await page.route('**/api/trpc/receiving.registerInvoice**', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Array<{ result?: { data?: { json?: Record<string, unknown> } } }>;
    const json = body[0]?.result?.data?.json;
    if (json) {
      invoiceId = String(json.invoiceId);
      json.ocrQueued = true; // the e2e server has no queue; the test is the worker
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

async function visibleCount(loc: Locator): Promise<number> {
  let n = 0;
  for (const el of await loc.all()) if (await el.isVisible()) n += 1;
  return n;
}

async function expectEachOnce(page: Page, names: string[]) {
  for (const name of names) {
    expect(await visibleCount(page.getByText(name, { exact: true })), `"${name}" rendered exactly once`).toBe(1);
  }
}

const REVIEW = { name: 'תוצאת ההצלבה' };

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url }, // the banner overlays the wizard's buttons
  ]);
});

test('desktop review: every line once, order+invoice / invoice-only / order-only sections', async ({ page }) => {
  test.setTimeout(180_000);
  const po = await freshPo('sections');
  const invoiceId = await scanAndProcess(page, po.poId);
  const [a, b, c, d] = po.lines;
  await finishOcr(invoiceId, [
    { productId: a!.productId, name: a!.name, qty: a!.qty, price: Math.round(a!.price * 108) / 100 },
    { productId: b!.productId, name: b!.name, qty: b!.qty + 1, price: b!.price },
    { productId: null, name: 'פריט שלא הוזמן בדיקה', qty: 1, price: 12 },
  ]);
  await expect(page.getByRole('heading', REVIEW)).toBeVisible({ timeout: 60_000 });

  await expectEachOnce(page, [a!.name, b!.name, c!.name, d!.name, 'פריט שלא הוזמן בדיקה']);
  expect(await visibleCount(page.getByTestId('recon-section-both'))).toBe(1);
  expect(await visibleCount(page.getByTestId('recon-section-invoiceOnly'))).toBe(1);
  expect(await visibleCount(page.getByTestId('recon-section-orderOnly'))).toBe(1);
  await expect(page.getByTestId('recon-mismatch-banner')).toHaveCount(0);
  // a and b sit in "on both"; the two un-billed order lines in "order only".
  const both = page.getByTestId('recon-section-both').locator('visible=true');
  await expect(both.getByText(a!.name, { exact: true })).toBeVisible();
  await expect(both.getByText(b!.name, { exact: true })).toBeVisible();
  const orderOnly = page.getByTestId('recon-section-orderOnly').locator('visible=true');
  await expect(orderOnly.getByText(c!.name, { exact: true })).toBeVisible();
  await expect(orderOnly.getByText(d!.name, { exact: true })).toBeVisible();
});

test('desktop review: an invoice that matches nothing on the order shows the mismatch banner', async ({ page }) => {
  test.setTimeout(180_000);
  const po = await freshPo('mismatch');
  const invoiceId = await scanAndProcess(page, po.poId);
  await finishOcr(invoiceId, [
    { productId: null, name: 'מברשות ניקוי תעשייתיות', qty: 3, price: 20 },
    { productId: null, name: 'נייר אפייה גליל', qty: 2, price: 35 },
  ]);
  await expect(page.getByRole('heading', REVIEW)).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId('recon-mismatch-banner')).toBeVisible();
  await expect(page.getByTestId('recon-pending-banner')).toHaveCount(0);
  await expectEachOnce(page, [...po.lines.map((l) => l.name), 'מברשות ניקוי תעשייתיות', 'נייר אפייה גליל']);
  expect(await visibleCount(page.getByTestId('recon-section-both'))).toBe(0);
  expect(await visibleCount(page.getByTestId('recon-section-invoiceOnly'))).toBe(1);
  expect(await visibleCount(page.getByTestId('recon-section-orderOnly'))).toBe(1);
});

test('late OCR: the result lands after the order-only fallback and keeps what was counted', async ({ page }) => {
  test.setTimeout(240_000);
  const po = await freshPo('late');
  const invoiceId = await scanAndProcess(page, po.poId);
  const [a, b, c] = po.lines;

  // No OCR yet: "still reading" after 30 s → continue with the order (the same
  // branch as the 120 s timeout: order-only review + background re-poll).
  await page.getByTestId('skip-ocr-wait').click({ timeout: 60_000 });
  await expect(page.getByRole('heading', REVIEW)).toBeVisible();
  await expect(page.getByTestId('ocr-notice-reading')).toBeVisible();

  // The receiver counts one more of c than ordered.
  await page.getByTestId('continue-adjust').click();
  const cardC = page.locator('.adjust-card').filter({ hasText: c!.name });
  await cardC.getByRole('button', { name: 'הגדל כמות' }).click();
  await expect(cardC.getByRole('spinbutton', { name: 'כמות שהתקבלה' })).toHaveValue(String(c!.qty + 1));

  // OCR finishes now — after the fallback.
  await finishOcr(invoiceId, [
    { productId: a!.productId, name: a!.name, qty: a!.qty, price: Math.round(a!.price * 108) / 100 },
    { productId: b!.productId, name: b!.name, qty: b!.qty + 1, price: b!.price },
    { productId: c!.productId, name: c!.name, qty: c!.qty, price: c!.price },
  ]);
  await expect(page.getByTestId('ocr-notice-ready')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'הצג תוצאות' }).click();

  // The review now carries the invoice lines…
  await expect(page.getByRole('heading', REVIEW)).toBeVisible();
  expect(await visibleCount(page.getByTestId('recon-section-both'))).toBe(1);
  await expectEachOnce(page, po.lines.map((l) => l.name));

  // …and closing the receipt still records the hand count for c.
  await page.getByTestId('continue-adjust').click();
  // Settle every other open line "= order"; c keeps the receiver's own count.
  for (const card of await page.locator('.adjust-card').all()) {
    if (!(await card.isVisible()) || (await card.innerText()).includes(c!.name)) continue;
    const btn = card.getByRole('button', { name: /^= הזמנה/ });
    if (await btn.isVisible()) await btn.click();
  }
  await expect(page.getByTestId('close-receipt')).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId('close-receipt').click();
  await expect(page.getByTestId('receipt-confirmed')).toBeVisible({ timeout: 60_000 });

  const sql = e2eSql();
  try {
    const [row] = await sql<{ qty: string }[]>`
      select qty_received::text as qty from gr_lines where po_line_id = ${c!.poLineId}`;
    expect(Number(row?.qty)).toBe(c!.qty + 1);
  } finally {
    await sql.end();
  }
});
