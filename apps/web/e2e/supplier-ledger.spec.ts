import { expect, test, type APIRequestContext } from '@playwright/test';
import { claimableLines, sumClaims } from '../../../packages/api/src/lib/claims';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';
import { seededLeakMonth } from './seededMonth';

/**
 * Flag `supplierLedger` on the seeded demo tenant (settings.features.all).
 * ₪ consistency for the month the seed populated (this month, or last month in a month's first
 * days — e2e/seededMonth.ts), summed over every supplier:
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
  const offset = await seededLeakMonth(page.request);
  const ledgers = await Promise.all(
    suppliers.map((s) => trpc<Ledger>(page.request, 'suppliers.ledger', { supplierId: s.id, months: 6 })),
  );
  // This month always ties out with the hero (₪0 = ₪0 in a month's first days)…
  const thisMonth = ledgers.map((l) => l.months.find((m) => m.current)!);
  const heroNow = await trpc<{ leakIls: number }>(page.request, 'owner.leakHero', {});
  expect(thisMonth.reduce((s, m) => s + m.leakAgorot, 0)).toBe(Math.round(heroNow.leakIls * 100));
  // …and the populated month carries every check below.
  const monthKey = (cur: string): string => {
    if (offset === 0) return cur;
    const [y, mo] = cur.split('-').map(Number) as [number, number];
    return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  };
  const current = ledgers.map((l) => {
    const key = monthKey(l.months.find((m) => m.current)!.month);
    const m = l.months.find((x) => x.month === key);
    expect(m, `ledger month ${key}`).toBeTruthy();
    return m!;
  });

  const hero = await trpc<{ leakIls: number }>(page.request, 'owner.leakHero', { monthOffset: offset });
  const leak = current.reduce((s, m) => s + m.leakAgorot, 0);
  expect(leak).toBe(Math.round(hero.leakIls * 100));
  expect(leak, 'the demo seed leaks in the month it populated').toBeGreaterThan(0);

  // The letters' total: the shared rule (lib/claims) over the month's breakdown — the letters page uses it too.
  const breakdown = await trpc<Array<Parameters<typeof claimableLines>[0]>>(page.request, 'owner.leakBreakdown', {
    monthOffset: offset,
    limit: 200,
  });
  const letters = Math.round(sumClaims(breakdown.flatMap((inv) => claimableLines(inv))) * 100);
  expect(current.reduce((s, m) => s + m.creditsAskedAgorot, 0)).toBe(letters);

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
