import { expect, test } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * B8 — when OCR fails, the invoice page says "enter the lines by hand": the owner
 * adds lines ("הוספת שורה") and deletes one ("מחיקת שורה"). The header totals are
 * recomputed on the server to the agora and the header fields follow them (a
 * later "save details" must never write back stale figures). 390-px phone.
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
});

async function failedInvoice(): Promise<{ id: string; restaurantId: string }> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    await sql`update restaurants set vat_rate = '0.18' where id = ${r!.id} and vat_rate is distinct from '0.18'`;
    const [sup] = await sql<{ id: string }[]>`
      insert into suppliers (restaurant_id, name, vat_rate) values (${r!.id}, ${`ספק ידני ${Math.random().toString(36).slice(2, 8)}`}, '0.18') returning id`;
    const [inv] = await sql<{ id: string }[]>`
      insert into invoices (restaurant_id, supplier_id, status, source, raw_image_url, ocr_confidence, ocr_payload)
      values (${r!.id}, ${sup!.id}, 'parsed', 'photo', 'https://example.com/failed.jpg', 0,
              ${sql.json({ provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed' } })})
      returning id`;
    return { id: inv!.id, restaurantId: r!.id };
  } finally {
    await sql.end();
  }
}

async function headerOf(id: string) {
  const sql = e2eSql();
  try {
    const [h] = await sql<{ excl: string | null; vat: string | null; incl: string | null; lines: number }[]>`
      select total_excl_vat::text as excl, vat_amount::text as vat, total_incl_vat::text as incl,
             (select count(*)::int from invoice_lines where invoice_id = ${id}) as lines
      from invoices where id = ${id}`;
    return h!;
  } finally {
    await sql.end();
  }
}

test('OCR failed: the owner adds lines by hand, deletes one; totals follow to the agora', async ({ page }) => {
  test.setTimeout(120_000);
  const inv = await failedInvoice();
  await page.goto(`/dashboard/invoices/${inv.id}`);
  await expect(page.getByTestId('invoice-ocr-failed')).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId('add-invoice-line-row');
  await expect(row).toBeVisible();

  async function add(desc: string, qty: string, unit: string, price: string) {
    await row.getByLabel('תיאור', { exact: true }).fill(desc);
    await row.getByLabel('כמות', { exact: true }).fill(qty);
    await row.getByLabel('יחידה', { exact: true }).fill(unit);
    await row.getByLabel('מחיר יח׳', { exact: true }).fill(price);
    await page.getByTestId('add-invoice-line').click();
    await expect(row.getByLabel('תיאור', { exact: true })).toHaveValue('', { timeout: 30_000 }); // cleared on success
  }
  await add('עגבניות', '2.5', 'ק״ג', '12.345'); // 30.8625 → 30.86
  await add('מלפפונים', '3', 'ק״ג', '9.99'); // 29.97

  await expect.poll(async () => (await headerOf(inv.id)).lines, { timeout: 30_000 }).toBe(2);
  expect(await headerOf(inv.id)).toMatchObject({ excl: '60.83', vat: '10.95', incl: '71.78' });
  // The header fields show the recomputed totals (no stale draft to save back).
  await expect(page.locator('#inv-excl')).toHaveValue('60.83');
  await expect(page.locator('#inv-incl')).toHaveValue('71.78');

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('delete-invoice-line').first().click();
  await expect.poll(async () => (await headerOf(inv.id)).lines, { timeout: 30_000 }).toBe(1);
  const after = await headerOf(inv.id);
  expect(['30.86', '29.97']).toContain(after.excl);
  await expect(page.locator('#inv-excl')).toHaveValue(after.excl!);
});
