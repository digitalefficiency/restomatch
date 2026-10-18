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
import { computeBaselines } from '../baselines';

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

async function seedWithHistory(prices: number[]) {
  const [r] = await db.insert(restaurants).values({ name: 'Baseline Bistro' }).returning();
  const [s] = await db
    .insert(suppliers)
    .values({ restaurantId: r!.id, name: 'Sup' })
    .returning();
  const [p] = await db
    .insert(products)
    .values({ restaurantId: r!.id, canonicalName: 'Item' })
    .returning();
  const now = new Date();
  for (let i = 0; i < prices.length; i += 1) {
    await db.insert(priceHistory).values({
      restaurantId: r!.id,
      productId: p!.id,
      supplierId: s!.id,
      observedAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
      unitPrice: prices[i]!.toString(),
      qty: '10',
    });
  }
  return { restaurantId: r!.id, productId: p!.id, supplierId: s!.id };
}

beforeEach(resetDb);
afterAll(resetDb);

describe('computeBaselines', () => {
  it('computes percentile_cont p50/p90 over price_history', async () => {
    const { restaurantId, productId } = await seedWithHistory([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const baselines = await computeBaselines(db, restaurantId);
    expect(baselines).toHaveLength(1);
    const b = baselines[0]!;
    expect(b.productId).toBe(productId);
    expect(b.p50).toBeCloseTo(9.5, 1);
    expect(b.p90).toBeCloseTo(13.1, 1);
    expect(b.mean).toBeCloseTo(9.5, 1);
    expect(b.sampleSize).toBe(10);
  });

  it('skips groups below minSamples threshold', async () => {
    await seedWithHistory([8, 9]); // only 2 samples
    const { restaurantId } = await seedWithHistory([8, 9]);
    const baselines = await computeBaselines(db, restaurantId, { minSamples: 5 });
    expect(baselines).toEqual([]);
  });

  it('upserts price_baselines row (insert on first run, update on second)', async () => {
    const { restaurantId, productId, supplierId } = await seedWithHistory([5, 6, 7, 8, 9]);
    const before = await db.select().from(priceBaselines);
    expect(before).toHaveLength(0);

    await computeBaselines(db, restaurantId);
    const after = await db.select().from(priceBaselines);
    expect(after).toHaveLength(1);
    expect(after[0]?.productId).toBe(productId);

    // Add new observation, re-run
    await db.insert(priceHistory).values({
      restaurantId,
      productId,
      supplierId,
      observedAt: new Date(),
      unitPrice: '20',
      qty: '1',
    });
    await computeBaselines(db, restaurantId);
    const again = await db.select().from(priceBaselines);
    expect(again).toHaveLength(1);
    expect(Number(again[0]?.mean)).toBeGreaterThan(Number(after[0]?.mean));
  });

  it('separate baselines per (product, supplier) pair', async () => {
    const { restaurantId, productId } = await seedWithHistory([5, 5, 5, 5, 5]);
    const [s2] = await db
      .insert(suppliers)
      .values({ restaurantId, name: 'Supplier 2' })
      .returning();
    for (let i = 0; i < 5; i += 1) {
      await db.insert(priceHistory).values({
        restaurantId,
        productId,
        supplierId: s2!.id,
        observedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        unitPrice: '10',
        qty: '1',
      });
    }
    const baselines = await computeBaselines(db, restaurantId);
    expect(baselines).toHaveLength(2);
    const s1Baseline = baselines.find((b) => b.mean === 5);
    const s2Baseline = baselines.find((b) => b.mean === 10);
    expect(s1Baseline).toBeDefined();
    expect(s2Baseline).toBeDefined();
  });

  it('respects windowDays filter', async () => {
    const { restaurantId } = await seedWithHistory([5, 5, 5, 5, 5]);
    // Old data — 200 days ago
    const [s] = await db.select({ id: suppliers.id }).from(suppliers);
    const [p] = await db.select({ id: products.id }).from(products);
    await db.insert(priceHistory).values({
      restaurantId,
      productId: p!.id,
      supplierId: s!.id,
      observedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      unitPrice: '100',
      qty: '1',
    });

    const baselines = await computeBaselines(db, restaurantId, { windowDays: 90 });
    expect(Number(baselines[0]?.mean)).toBeCloseTo(5, 1); // old outlier excluded
  });
});
