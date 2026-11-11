import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  priceHistory,
  products,
  restaurants,
  supplierContractPrices,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { lockCurrentPrices, loadPriceContext } from '../contracts/priceContext';
import { localDateKey } from '../contracts/core';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-12 `contracts.priceContext`, `contracts.lockCurrentPrices`, `contracts.adoptPrice`. */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let salmonId: string;

const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const daysAgo = (n: number, from = Date.now()) => new Date(from - n * 86_400_000);
const todayIl = (now = new Date()) => localDateKey(now, 'Asia/Jerusalem');

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db
      .update(restaurants)
      .set({ settings: { features: { all: true } } as RestaurantSettings })
      .where(eq(restaurants.id, t.restaurantId));
  }
  const [s] = await db
    .insert(products)
    .values({ restaurantId: A.restaurantId, canonicalName: 'פילה סלמון', defaultUnit: 'ק״ג', supplierId: A.supplierId })
    .returning();
  salmonId = s!.id;
});

beforeEach(async () => {
  await db.delete(supplierContractPrices);
  await db.delete(priceHistory);
  // Salmon at A's supplier: 90-day median ₪91.40-ish story; last ₪96.00 two days ago.
  const points: Array<[number, string, string]> = [
    [120, '80.00', '5'], // outside the 90-day window: not in the median
    [40, '89.00', '6'],
    [30, '90.00', '6'],
    [20, '91.40', '6'],
    [10, '92.00', '6'],
    [2, '96.00', '6'],
  ];
  for (const [d, p, q] of points) {
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      productId: salmonId,
      supplierId: A.supplierId,
      observedAt: daysAgo(d),
      unitPrice: p,
      qty: q,
    });
  }
});

afterAll(async () => {
  await resetDb(db);
});

describe('contracts.priceContext (W2-12)', () => {
  it('returns the last invoiced price + its date and the 90-day median', async () => {
    const ctx = await caller(A, 'bookkeeper').contracts.priceContext({ supplierId: A.supplierId, productId: salmonId });
    expect(ctx.lastPrice).toBe(96);
    expect(ctx.lastAt!.getTime()).toBeGreaterThan(daysAgo(3).getTime());
    expect(ctx.median90).toBe(91.4);
    expect(ctx.observations).toBe(5);
  });

  it('is empty (null, not ₪0) without history', async () => {
    const ctx = await loadPriceContext(db, A.restaurantId, A.supplierId, A.productId);
    expect(ctx).toEqual({ lastPrice: null, lastAt: null, median90: null, observations: 0 });
  });
});

describe('contracts.lockCurrentPrices (W2-12)', () => {
  it('dry run names the count and ₪ without writing', async () => {
    const res = await caller(A, 'manager').contracts.lockCurrentPrices({ supplierId: A.supplierId, dryRun: true });
    expect(res.count).toBe(1);
    // ₪96 × 30 kg (90 days) ÷ 3 = ₪960/month.
    expect(res.monthlyAgorot).toBe(96_000);
    expect(res.candidates[0]).toMatchObject({ productId: salmonId, price: 96 });
    expect(await db.select().from(supplierContractPrices)).toHaveLength(0);
  });

  it('writes the last invoiced price from TODAY in Asia/Jerusalem, never earlier; idempotent per day', async () => {
    const c = caller(A, 'manager');
    const first = await c.contracts.lockCurrentPrices({ supplierId: A.supplierId });
    expect(first.created).toBe(1);
    const rows = await db.select().from(supplierContractPrices).where(eq(supplierContractPrices.restaurantId, A.restaurantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: salmonId, contractPrice: '96.0000', validFrom: todayIl(), validTo: null, source: 'manual' });
    const again = await c.contracts.lockCurrentPrices({ supplierId: A.supplierId });
    expect(again.created).toBe(0);
    expect(await db.select().from(supplierContractPrices)).toHaveLength(1);
  });

  it('dates by the restaurant day: 23:30 UTC on 7.11 is already 8.11 in Jerusalem', async () => {
    const now = new Date('2026-11-07T23:30:00Z');
    await db.delete(priceHistory);
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      productId: salmonId,
      supplierId: A.supplierId,
      observedAt: daysAgo(1, now.getTime()),
      unitPrice: '95.00',
      qty: '3',
    });
    const res = await lockCurrentPrices(db, { restaurantId: A.restaurantId, supplierId: A.supplierId, userId: null, now });
    expect(res.today).toBe('2026-11-08');
    const [row] = await db.select().from(supplierContractPrices);
    expect(row!.validFrom).toBe('2026-11-08');
  });

  it('never overwrites a product that already has a contract (the leak definition stays put)', async () => {
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: salmonId,
      contractPrice: '89.0000',
      validFrom: '2020-01-01',
    });
    const res = await caller(A, 'manager').contracts.lockCurrentPrices({ supplierId: A.supplierId });
    expect(res.created).toBe(0);
    const rows = await db.select().from(supplierContractPrices);
    expect(rows.map((r) => r.contractPrice)).toEqual(['89.0000']);
  });
});

describe('contracts.adoptPrice (W2-12 "עדכנו מחיר חוזה")', () => {
  it('adds a row from today (old row untouched), and a same-day repeat updates it and returns the previous price', async () => {
    await db.insert(supplierContractPrices).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: salmonId,
      contractPrice: '89.0000',
      validFrom: '2020-01-01',
    });
    const c = caller(A, 'manager');
    const r1 = await c.contracts.adoptPrice({ supplierId: A.supplierId, productId: salmonId, contractPrice: 96 });
    expect(r1).toMatchObject({ created: true, validFrom: todayIl(), previousPrice: null });
    const r2 = await c.contracts.adoptPrice({ supplierId: A.supplierId, productId: salmonId, contractPrice: 95 });
    expect(r2).toMatchObject({ id: r1.id, created: false, previousPrice: 96 });
    const rows = await db.select().from(supplierContractPrices).orderBy(supplierContractPrices.validFrom);
    expect(rows.map((r) => [r.validFrom, r.contractPrice])).toEqual([
      ['2020-01-01', '89.0000'],
      [todayIl(), '95.0000'],
    ]);
    // Undo of a created row = delete it (the existing manager procedure).
    await c.contracts.delete({ id: r1.id });
    expect(await db.select().from(supplierContractPrices)).toHaveLength(1);
  });

  it('bookkeeper reads context but cannot write', async () => {
    await expect(
      caller(A, 'bookkeeper').contracts.adoptPrice({ supplierId: A.supplierId, productId: salmonId, contractPrice: 96 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'bookkeeper').contracts.lockCurrentPrices({ supplierId: A.supplierId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
