import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, poLines, products, purchaseOrders, supplierCatalogItems, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { buildOrderGuide, median } from '../orders/guide';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-06 §5.1 — the order guide from the supplier's last 8 POs. */
const db = createDb(testDbUrl());
let A: Tenant;
let onion: string;

const callerFor = (t: Tenant, role: Session['role']) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

/** One PO `daysAgo` with `lines` (productId → qty). */
async function po(daysAgo: number, lines: Array<[string, number]>, over: Partial<typeof purchaseOrders.$inferInsert> = {}) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  const [row] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'sent', source: 'manual', sentAt: at, createdAt: at, ...over })
    .returning({ id: purchaseOrders.id });
  if (lines.length) {
    await db
      .insert(poLines)
      .values(lines.map(([productId, q]) => ({ poId: row!.id, productId, qtyOrdered: String(q), unit: 'kg', unitPriceExpected: '10' })));
  }
  return row!.id;
}

describe('orders.orderGuide', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    // The fixture PO (sent, today, one unmapped line) is one of the 8; keep it out of the way.
    await db.delete(poLines).where(eq(poLines.poId, A.poId));
    const [o] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, canonicalName: 'בצל', category: 'ירקות', defaultUnit: 'kg' })
      .returning({ id: products.id });
    onion = o!.id;
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('median: odd, even (mean of the middle two), empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
    expect(median([])).toBe(0);
  });

  it('usualQty = the median of the LAST 4 appearances; lastQty = the newest; ≥ 2 of 8', async () => {
    await po(10, [[A.productId, 100], [onion, 1]]); // oldest — outside the last 4 for tomatoes
    await po(8, [[A.productId, 4]]);
    await po(6, [[A.productId, 6]]);
    await po(4, [[A.productId, 5]]);
    await po(2, [[A.productId, 7]]);
    const g = await buildOrderGuide(db, { restaurantId: A.restaurantId, supplierId: A.supplierId });
    const tomato = g.rows.find((r) => r.productId === A.productId)!;
    expect(tomato).toMatchObject({ usualQty: 5.5, lastQty: 7, timesOrdered: 5, unit: 'kg', category: 'ירקות' });
    // onion appeared once → not in the guide
    expect(g.rows.find((r) => r.productId === onion)).toBeUndefined();
  });

  it('only the last 8 placed POs count; drafts, cancelled and walk-ins never do', async () => {
    await po(30, [[onion, 2]]);
    await po(29, [[onion, 2]]); // two old onion orders…
    for (let d = 9; d >= 2; d--) await po(d, [[A.productId, 3]]); // …pushed out by 8 newer POs (+ the fixture PO)
    await po(1, [[onion, 9]], { status: 'draft' });
    await po(1, [[onion, 9]], { status: 'cancelled' });
    await po(1, [[onion, 9]], { sourceRef: 'walk_in:x' });
    const g = await buildOrderGuide(db, { restaurantId: A.restaurantId, supplierId: A.supplierId });
    expect(g.poCount).toBe(8);
    expect(g.rows.map((r) => r.productId)).toEqual([A.productId]);
  });

  it('carries the expected price for price viewers; the receiver gets no price keys', async () => {
    await po(4, [[A.productId, 5]]);
    await po(2, [[A.productId, 7]]);
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'x',
      unit: 'kg',
      listPrice: '99',
      updatedAt: new Date(Date.now() - 100 * 86_400_000),
    });
    const chef = await callerFor(A, 'manager').orders.orderGuide({ supplierId: A.supplierId });
    expect(chef.rows[0]).toMatchObject({ unitPrice: 10, priceSource: 'last_po' });
    const { forRole } = await import('../orders/access');
    const redacted = forRole('receiver', chef);
    expect(JSON.stringify(redacted)).not.toMatch(/unitPrice|priceSource|total/);
    expect(redacted.rows[0]).toMatchObject({ usualQty: 6, lastQty: 7 });
  });

  it('no PO history → an empty guide (never an invented line)', async () => {
    const [s2] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק חדש' }).returning({ id: suppliers.id });
    const g = await buildOrderGuide(db, { restaurantId: A.restaurantId, supplierId: s2!.id });
    expect(g).toEqual({ supplierId: s2!.id, poCount: 0, rows: [] });
  });
});
