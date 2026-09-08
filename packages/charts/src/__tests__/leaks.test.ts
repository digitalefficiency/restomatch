import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { computeLeaks } from '../leaks';

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

interface SeedResult {
  restaurantId: string;
  supplierId: string;
  productId: string;
}

async function seedWithBaseline(currentPrice: number, p50 = 8, p90 = 9): Promise<SeedResult> {
  const [r] = await db.insert(restaurants).values({ name: 'Leak Bistro' }).returning();
  const [s] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'ירקני אבי' })
    .returning();
  const [p] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'עגבניה שרי', category: 'ירקות' })
    .returning();

  await db.insert(priceBaselines).values({
    restaurantId: r!.id,
    productId: p!.id,
    supplierId: s!.id,
    windowDays: 90,
    p50: p50.toString(),
    p90: p90.toString(),
    mean: p50.toString(),
    stddev: '0.5',
    sampleSize: 30,
  });

  await db.insert(priceHistory).values({
    restaurantId: r!.id,
    productId: p!.id,
    supplierId: s!.id,
    observedAt: new Date(),
    unitPrice: currentPrice.toString(),
    qty: '10',
  });

  return { restaurantId: r!.id, supplierId: s!.id, productId: p!.id };
}

beforeEach(resetDb);
afterAll(resetDb);

describe('computeLeaks', () => {
  it('flags products whose current price exceeds p90 by deltaPct threshold', async () => {
    const { restaurantId, productId } = await seedWithBaseline(11, 8, 9); // 38% above p50
    const leaks = await computeLeaks(db, restaurantId);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.productId).toBe(productId);
    expect(leaks[0]?.deltaPct).toBeCloseTo(0.375, 2);
  });

  it('quantifies month excess from real 30-day quantity, not a constant', async () => {
    const [r] = await db.insert(restaurants).values({ name: 'Qty Bistro' }).returning();
    const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: 'ספק' }).returning();
    const [p] = await db
      .insert(products)
      .values({ restaurantId: r!.id, canonicalName: 'בצל' })
      .returning();
    await db.insert(priceBaselines).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId: s!.id,
      windowDays: 90,
      p50: '8',
      p90: '9',
      mean: '8',
      stddev: '0.5',
      sampleSize: 30,
    });
    // Two purchases this month: qty 7 + 13 = 20; latest price 11.
    await db.insert(priceHistory).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId: s!.id,
      observedAt: new Date(Date.now() - 5 * 86400000),
      unitPrice: '10',
      qty: '7',
    });
    await db.insert(priceHistory).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId: s!.id,
      observedAt: new Date(),
      unitPrice: '11',
      qty: '13',
    });
    const leaks = await computeLeaks(db, r!.id);
    expect(leaks).toHaveLength(1);
    // (11 - 8) * 20 = 60 — the old constant ×10 would give 30.
    expect(leaks[0]?.monthExcessIls).toBeCloseTo(60, 1);
    expect(leaks[0]?.series).toEqual([10, 11]);
  });

  it('does not flag prices within p90 threshold', async () => {
    const { restaurantId } = await seedWithBaseline(8.5, 8, 9); // under p90
    const leaks = await computeLeaks(db, restaurantId);
    expect(leaks).toEqual([]);
  });

  it('filters by minDeltaPct option', async () => {
    const { restaurantId } = await seedWithBaseline(9.3, 8, 9); // 16% above p50
    const lenient = await computeLeaks(db, restaurantId, { minDeltaPct: 0.05 });
    expect(lenient).toHaveLength(1);
    const strict = await computeLeaks(db, restaurantId, { minDeltaPct: 0.2 });
    expect(strict).toEqual([]);
  });

  it('returns rows sorted by deltaPct DESC', async () => {
    const { restaurantId, supplierId, productId } = await seedWithBaseline(11, 8, 9); // 38%
    // Add a second product with smaller leak
    const [p2] = await db
      .insert(products)
      .values({ restaurantId, canonicalName: 'מלפפון', category: 'ירקות' })
      .returning();
    await db.insert(priceBaselines).values({
      restaurantId,
      productId: p2!.id,
      supplierId,
      windowDays: 90,
      p50: '5',
      p90: '5.5',
      mean: '5',
      stddev: '0.2',
      sampleSize: 20,
    });
    await db.insert(priceHistory).values({
      restaurantId,
      productId: p2!.id,
      supplierId,
      observedAt: new Date(),
      unitPrice: '6', // 20% above p50
      qty: '5',
    });

    const leaks = await computeLeaks(db, restaurantId);
    expect(leaks).toHaveLength(2);
    expect(leaks[0]?.productId).toBe(productId);
    expect(leaks[0]?.deltaPct).toBeGreaterThan(leaks[1]!.deltaPct);
  });

  it('respects limit option', async () => {
    const { restaurantId, supplierId } = await seedWithBaseline(11, 8, 9);
    // Add 5 more products with leaks
    for (let i = 0; i < 5; i += 1) {
      const [p] = await db
        .insert(products)
        .values({ restaurantId, canonicalName: `Product ${i}` })
        .returning();
      await db.insert(priceBaselines).values({
        restaurantId,
        productId: p!.id,
        supplierId,
        windowDays: 90,
        p50: '5',
        p90: '5.5',
        mean: '5',
        stddev: '0.1',
        sampleSize: 10,
      });
      await db.insert(priceHistory).values({
        restaurantId,
        productId: p!.id,
        supplierId,
        observedAt: new Date(),
        unitPrice: (5.5 + i * 0.5).toString(),
        qty: '1',
      });
    }
    const leaks = await computeLeaks(db, restaurantId, { limit: 3, minDeltaPct: 0.05 });
    expect(leaks.length).toBeLessThanOrEqual(3);
  });

  it('respects restaurant scoping', async () => {
    const { restaurantId } = await seedWithBaseline(11, 8, 9);
    const [otherRest] = await db
      .insert(restaurants)
      .values({ name: 'Other' })
      .returning();
    const leaks = await computeLeaks(db, otherRest!.id);
    expect(leaks).toEqual([]);
  });
});
