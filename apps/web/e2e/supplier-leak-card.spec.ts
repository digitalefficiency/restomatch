import { expect, test } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * Flag `supplierLeakCard` on the seeded demo tenant (settings.features.all):
 *   - the supplier "Leak" tab's 90-day ₪ equals the leak explorer grouped by
 *     supplier for the same window (owner.leakGrouped, no supplier filter);
 *   - the negotiation card prints as ONE A4 page;
 *   - a supplier with no findings gets the calm good-news state.
 */
test.use({ storageState: OWNER_STATE });

type GroupRow = { key: string; leakIls: number };

async function explorerBySupplier(
  request: import('@playwright/test').APIRequestContext,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  const input = { json: { view: { period: 'custom', from, to }, groupBy: 'supplier', compare: 'off' } };
  const res = await request.get(`/api/trpc/owner.leakGrouped?input=${encodeURIComponent(JSON.stringify(input))}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { result: { data: { json: { rows: GroupRow[] } } } };
  return body.result.data.json.rows;
}

let suppliers: Array<{ id: string; name: string }> = [];

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    suppliers = await sql<Array<{ id: string; name: string }>>`
      select s.id, s.name from suppliers s join restaurants r on r.id = s.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} order by s.name`;
  } finally {
    await sql.end();
  }
  expect(suppliers.length).toBeGreaterThan(1);
});

test('the supplier leak ₪ equals the leak explorer grouped by supplier', async ({ page }) => {
  const errors = collectPageErrors(page);
  // The window is the card's own (last 90 Israel days): read it off the page.
  await page.goto(`/dashboard/suppliers/${suppliers[0]!.id}?tab=leak`);
  const any = page.locator('[data-testid="supplier-leak-total"], [data-testid="supplier-leak-clean"]').first();
  await expect(any).toBeVisible();
  const from = (await any.getAttribute('data-from'))!;
  const to = (await any.getAttribute('data-to'))!;
  const rows = await explorerBySupplier(page.request, from, to);
  const leaking = rows.filter((r) => r.key && r.leakIls > 0);
  expect(leaking.length, 'the demo seed has leaking suppliers').toBeGreaterThan(0);

  for (const row of leaking.slice(0, 3)) {
    await page.goto(`/dashboard/suppliers/${row.key}?tab=leak`);
    const total = page.getByTestId('supplier-leak-total');
    await expect(total).toBeVisible();
    expect(Number(await total.getAttribute('data-agorot'))).toBe(Math.round(row.leakIls * 100));
    expect(await total.getAttribute('data-from')).toBe(from);
  }
  expect(errors).toEqual([]);
});

test('a supplier with no findings gets the calm good-news state', async ({ page }) => {
  await page.goto(`/dashboard/suppliers/${suppliers[0]!.id}?tab=leak`);
  const any = page.locator('[data-testid="supplier-leak-total"], [data-testid="supplier-leak-clean"]').first();
  const from = (await any.getAttribute('data-from'))!;
  const to = (await any.getAttribute('data-to'))!;
  const leakingIds = new Set((await explorerBySupplier(page.request, from, to)).filter((r) => r.leakIls > 0).map((r) => r.key));
  const clean = suppliers.find((s) => !leakingIds.has(s.id));
  test.skip(!clean, 'every demo supplier leaks in this window');
  await page.goto(`/dashboard/suppliers/${clean!.id}?tab=leak`);
  await expect(page.getByTestId('supplier-leak-clean')).toBeVisible();
  await expect(page.getByTestId('supplier-leak-total')).toHaveCount(0);
});

test('the negotiation card prints as one A4 page', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/suppliers/${suppliers[0]!.id}?tab=leak`);
  const any = page.locator('[data-testid="supplier-leak-total"], [data-testid="supplier-leak-clean"]').first();
  const rows = await explorerBySupplier(page.request, (await any.getAttribute('data-from'))!, (await any.getAttribute('data-to'))!);
  const top = rows.filter((r) => r.key && r.leakIls > 0).sort((a, b) => b.leakIls - a.leakIls)[0]!;
  await page.goto(`/dashboard/suppliers/${top.key}/leak-card`);
  await expect(page.locator('#supplier-leak-card')).toBeVisible();
  await expect(page.locator('#supplier-leak-card')).toHaveAttribute('dir', 'rtl');
  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBe(1);
  expect(errors).toEqual([]);
});
