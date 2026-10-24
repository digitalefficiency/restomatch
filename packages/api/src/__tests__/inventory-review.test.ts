import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  inventoryCounts,
  invoiceLines,
  invoices,
  matchRuns,
  priceHistory,
  products,
  restaurants,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { localToday, purchasesInPeriod } from '../inventory/data';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * The #106 review: credits are goods-line overcharges only (never a VAT or a
 * price-lower finding), dated when the credit was received; a credit note (a
 * negative invoice) lowers purchases; beverages and the bar are not food cost;
 * an invoice without an ex-VAT total falls back to incl − VAT; a period whose
 * counts are incomplete carries its coverage and never alarms; a count can't be
 * closed on or before the latest closed count.
 */
const db = createDb(testDbUrl());
const TZ = 'Asia/Jerusalem';
const DAY = 86_400_000;
const ymdAgo = (n: number) => localToday(TZ, new Date(Date.now() - n * DAY));
const atAgo = (n: number) => new Date(`${ymdAgo(n)}T09:00:00Z`);
let T: Tenant;
let beef: string;

const caller = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

async function invoice(number: string, daysAgo: number, excl: string | null, extra: Partial<typeof invoices.$inferInsert> = {}) {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, source: 'manual', invoiceNumber: number, invoiceDate: atAgo(daysAgo), totalExclVat: excl, status: 'matched', ...extra })
    .returning();
  return inv!.id;
}

async function line(invoiceId: string, productId: string, total: string) {
  const [l] = await db
    .insert(invoiceLines)
    .values({ invoiceId, productId, rawDescription: 'x', qtyBilled: '1', unit: 'ק״ג', unitPriceBilled: total, lineTotal: total })
    .returning();
  return l!.id;
}

async function claim(invoiceId: string, type: string, delta: string, status: string, lineId: string | null, resolvedAt: Date | null = null) {
  const [mr] = await db.insert(matchRuns).values({ restaurantId: T.restaurantId, invoiceId, overallStatus: 'minor' }).returning();
  await db.insert(discrepancies).values({
    restaurantId: T.restaurantId,
    matchRunId: mr!.id,
    type: type as never,
    severity: 'warn',
    deltaAmount: delta,
    resolutionStatus: status as never,
    invoiceLineId: lineId,
    resolvedAt,
  });
}

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'RV');
  await db.update(restaurants).set({ settings: { features: { inventoryCount: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, T.restaurantId));
  beef = (await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'בקר', defaultUnit: 'ק״ג', category: 'בשר' }).returning())[0]!.id;
});

beforeEach(async () => {
  await db.delete(invoices).where(eq(invoices.restaurantId, T.restaurantId));
  await db.delete(inventoryCounts).where(eq(inventoryCounts.restaurantId, T.restaurantId));
});

afterAll(async () => {
  await resetDb(db);
});

describe('credits received: goods-line overcharges only', () => {
  it('PRICE_HIGHER / QTY_OVER / UNORDERED_ITEM / QTY_SHORT count; VAT_MISMATCH, PRICE_LOWER, MISSING_ON_INVOICE and a zero Δ do not', async () => {
    const id = await invoice('C-1', 5, '5000.00');
    const l = await line(id, beef, '5000.00');
    await claim(id, 'PRICE_HIGHER', '100.00', 'resolved', l);
    await claim(id, 'QTY_OVER', '-50.00', 'resolved', l);
    await claim(id, 'UNORDERED_ITEM', '20.00', 'resolved', l);
    await claim(id, 'QTY_SHORT', '10.00', 'resolved', l);
    await claim(id, 'QTY_SHORT', '0.00', 'resolved', l);
    await claim(id, 'VAT_MISMATCH', '12.66', 'resolved', null);
    await claim(id, 'PRICE_LOWER', '30.00', 'resolved', l);
    await claim(id, 'MISSING_ON_INVOICE', '40.00', 'resolved', null);
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), ymdAgo(0));
    expect(p.creditsAgorot).toBe(18_000); // 100 + 50 + 20 + 10
  });

  it('a credit counts in the period it was RECEIVED (resolved_at), not by the invoice date', async () => {
    const old = await invoice('C-OLD', 40, '1000.00');
    const l = await line(old, beef, '1000.00');
    await claim(old, 'PRICE_HIGHER', '70.00', 'resolved', l, atAgo(3));
    const recent = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), ymdAgo(0));
    expect(recent).toMatchObject({ invoicesAgorot: 0, creditsAgorot: 7_000 });
    const back = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(50), ymdAgo(30));
    expect(back).toMatchObject({ invoicesAgorot: 100_000, creditsAgorot: 0 });
  });
});

describe('purchases', () => {
  it('a credit note (negative invoice) lowers food purchases, never raises them', async () => {
    await invoice('P-1', 5, '1000.00');
    const cn = await invoice('CN-1', 4, '-200.00');
    await line(cn, beef, '-200.00');
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), ymdAgo(0));
    expect(p).toMatchObject({ invoicesAgorot: 80_000, nonFoodAgorot: 0, purchasesAgorot: 80_000 });
  });

  it('beverages are not food cost: their lines and their credits are out', async () => {
    const wine = (await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'יין', defaultUnit: 'בקבוק', category: 'משקאות' }).returning())[0]!.id;
    const id = await invoice('B-1', 5, '1000.00');
    await line(id, beef, '600.00');
    const wl = await line(id, wine, '400.00');
    await claim(id, 'PRICE_HIGHER', '25.00', 'resolved', wl);
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), ymdAgo(0));
    expect(p).toMatchObject({ invoicesAgorot: 100_000, beverageAgorot: 40_000, creditsAgorot: 0, purchasesAgorot: 60_000 });
  });

  it('no ex-VAT total: falls back to incl − VAT', async () => {
    await invoice('N-1', 5, null, { totalInclVat: '1170.00', vatAmount: '170.00' });
    const p = await purchasesInPeriod(db, T.restaurantId, TZ, ymdAgo(10), ymdAgo(0));
    expect(p).toMatchObject({ invoicesAgorot: 100_000, purchasesAgorot: 100_000, missingTotalCount: 0 });
  });
});

describe('period: the bar is not food, coverage per count, close order', () => {
  async function closedCount(daysAgo: number, lines: Array<{ productId: string; qty: string | null; area?: 'bar' }>) {
    const c = caller(T);
    const { id } = await c.inventory.start({ countDate: ymdAgo(daysAgo) });
    await c.inventory.saveLines({ countId: id, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(l.area ? { storageArea: l.area } : {}) })) });
    await c.inventory.complete({ countId: id, acceptUncounted: true });
    return id;
  }

  it('bar-area and beverage lines stay out of the opening and closing food values', async () => {
    const beer = (await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'בירה', defaultUnit: 'ליטר', category: 'משקאות' }).returning())[0]!.id;
    await db.insert(priceHistory).values([
      { restaurantId: T.restaurantId, productId: beef, supplierId: T.supplierId, observedAt: atAgo(30), unitPrice: '100.0000' },
      { restaurantId: T.restaurantId, productId: beer, supplierId: T.supplierId, observedAt: atAgo(30), unitPrice: '10.0000' },
    ]);
    await closedCount(20, [{ productId: beef, qty: '2' }, { productId: beer, qty: '30' }]);
    await closedCount(5, [{ productId: beef, qty: '1' }, { productId: beer, qty: '50' }]);
    const p = await caller(T).inventory.period();
    expect(p.available).toBe(true);
    if (!p.available) return;
    // Beef only: ₪200 → ₪100. The beer (₪300 → ₪500) is the bar's, not food.
    expect(p.opening.valueAgorot).toBe(20_000);
    expect(p.closing.valueAgorot).toBe(10_000);
    expect(p.actualAgorot).toBe(10_000);
    expect(p.opening.coverage).toMatchObject({ lines: 1, counted: 1, unpriced: 0 });
  });

  it('an end under ~95% counted carries its coverage and never raises a variance alarm', async () => {
    const rice = (await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'אורז', defaultUnit: 'ק״ג', category: 'יבשים' }).returning())[0]!.id;
    await db.insert(priceHistory).values({ restaurantId: T.restaurantId, productId: beef, supplierId: T.supplierId, observedAt: atAgo(30), unitPrice: '100.0000' });
    await closedCount(20, [{ productId: beef, qty: '2' }, { productId: rice, qty: '1' }]);
    await closedCount(5, [{ productId: beef, qty: '1' }, { productId: rice, qty: null }]);
    const p = await caller(T).inventory.period();
    if (!p.available) throw new Error('period');
    expect(p.closing.coverage).toMatchObject({ lines: 2, counted: 1 });
    expect(p.coverageComplete).toBe(false);
    expect(p.varianceAlert).toBe(false);
    await db.delete(products).where(eq(products.id, rice)).catch(() => undefined);
  });

  it('closing a count dated on or before the latest closed count is refused', async () => {
    await db.insert(priceHistory).values({ restaurantId: T.restaurantId, productId: beef, supplierId: T.supplierId, observedAt: atAgo(30), unitPrice: '100.0000' });
    await closedCount(5, [{ productId: beef, qty: '1' }]);
    const c = caller(T);
    for (const d of [5, 8]) {
      const { id } = await c.inventory.start({ countDate: ymdAgo(d) });
      await c.inventory.saveLines({ countId: id, lines: [{ productId: beef, qty: '1' }] });
      await expect(c.inventory.complete({ countId: id, acceptUncounted: true })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: `NOT_AFTER_LAST:${ymdAgo(5)}` });
      await c.inventory.discard({ countId: id });
    }
  });
});
