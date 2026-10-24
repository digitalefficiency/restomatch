import { expect, test, type APIRequestContext } from '@playwright/test';
import { claimableAgorot } from '../../../packages/api/src/ledger/credits';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * Flag `supplierLedger` on the seeded demo tenant (settings.features.all).
 * ₪ consistency for the current month, summed over every supplier:
 *   - ledger leak == the hero leak (owner.leakHero);
 *   - credits asked == the claim letters' total (same shared claimable rule
 *     over owner.leakBreakdown — the letters page uses it too);
 *   - each supplier's delivery-note ₪ == Σ received × PO price straight from
 *     the receiving tables.
 */
test.use({ storageState: OWNER_STATE });

async function trpc<T>(request: APIRequestContext, path: string, input: unknown): Promise<T> {
  const res = await request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  expect(res.status(), path).toBe(200);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

type Ledger = {
  timezone: string;
  months: Array<{ month: string; current: boolean; leakAgorot: number; creditsAskedAgorot: number; notes: { count: number; agorot: number } }>;
};

let suppliers: Array<{ id: string }> = [];

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    suppliers = await sql<Array<{ id: string }>>`
      select s.id from suppliers s join restaurants r on r.id = s.restaurant_id where r.name = ${DEMO_RESTAURANT_NAME}`;
  } finally {
    await sql.end();
  }
  expect(suppliers.length).toBeGreaterThan(1);
});

test('ledger ₪ ties out with the hero, the claim letters and the receiving data', async ({ page }) => {
  await page.goto('/dashboard');
  const ledgers = await Promise.all(
    suppliers.map((s) => trpc<Ledger>(page.request, 'suppliers.ledger', { supplierId: s.id, months: 6 })),
  );
  const current = ledgers.map((l) => l.months.find((m) => m.current)!);

  const hero = await trpc<{ leakIls: number }>(page.request, 'owner.leakHero', {});
  const leak = current.reduce((s, m) => s + m.leakAgorot, 0);
  expect(leak).toBe(Math.round(hero.leakIls * 100));
  expect(leak, 'the demo seed leaks this month').toBeGreaterThan(0);

  const breakdown = await trpc<Parameters<typeof claimableAgorot>[0]>(page.request, 'owner.leakBreakdown', { limit: 200 });
  expect(current.reduce((s, m) => s + m.creditsAskedAgorot, 0)).toBe(claimableAgorot(breakdown));

  const sql = e2eSql();
  try {
    const month = current[0]!.month;
    for (const [i, s] of suppliers.entries()) {
      const [row] = await sql<Array<{ agorot: string | null; n: string }>>`
        select coalesce(sum(round(gl.qty_received * pl.unit_price_expected * 100)), 0) as agorot,
               count(distinct gr.id) as n
        from goods_receipts gr
        join purchase_orders po on po.id = gr.po_id
        join gr_lines gl on gl.gr_id = gr.id
        join po_lines pl on pl.id = gl.po_line_id
        where po.supplier_id = ${s.id} and gr.status <> 'pending' and pl.unit_price_expected is not null
          and to_char(gr.received_at at time zone ${ledgers[i]!.timezone}, 'YYYY-MM') = ${month}`;
      expect(current[i]!.notes.agorot, `supplier ${s.id}`).toBe(Number(row!.agorot));
    }
  } finally {
    await sql.end();
  }
});

test('the ledger tab and the all-suppliers grid render with no console errors', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/suppliers/${suppliers[0]!.id}?tab=ledger`);
  await expect(page.getByTestId('supplier-ledger')).toBeVisible();
  await page.goto('/dashboard/suppliers/ledger');
  await expect(page.getByTestId('ledger-grid')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ledger-csv').click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  expect(errors).toEqual([]);
});
