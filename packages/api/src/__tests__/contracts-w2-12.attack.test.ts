import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  priceAlerts,
  priceHistory,
  restaurants,
  supplierContractPrices,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-12 cross-tenant + role attacks on every new or changed procedure:
 * contracts.{queue, priceContext, lockCurrentPrices, adoptPrice, importDiff,
 * importCommit(excludeRowIds)} and priceAlerts.{previewThreshold,
 * dismiss(reason), reopen}. Tenant B aims at A's ids → NOT_FOUND or empty, and
 * A's rows are unchanged; receiver/chef → FORBIDDEN. COVERAGE: coverage/W2-12.ts.
 */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let alertA: string;
let contractA: string;

const as = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const csv = 'תיאור,מחיר חוזה\nעגבניה A,9.90\n';
const file = { filename: 'p.csv', text: csv };
const mapping = { name: 'תיאור', price: 'מחיר חוזה' };

async function snapshotA() {
  const contracts = await db
    .select({ id: supplierContractPrices.id, price: supplierContractPrices.contractPrice, from: supplierContractPrices.validFrom })
    .from(supplierContractPrices)
    .where(eq(supplierContractPrices.restaurantId, A.restaurantId))
    .orderBy(supplierContractPrices.id);
  const alerts = await db
    .select({ id: priceAlerts.id, status: priceAlerts.status })
    .from(priceAlerts)
    .where(eq(priceAlerts.restaurantId, A.restaurantId));
  return { contracts, alerts };
}

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
});

beforeEach(async () => {
  await db.delete(supplierContractPrices);
  await db.delete(priceAlerts);
  await db.delete(priceHistory);
  const [c] = await db
    .insert(supplierContractPrices)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, contractPrice: '9.0000', validFrom: '2020-01-01' })
    .returning();
  contractA = c!.id;
  for (const [d, p] of [[20, '6.20'], [16, '6.20'], [8, '7.30'], [4, '7.32'], [1, '7.34']] as const) {
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      productId: A.productId,
      supplierId: A.supplierId,
      observedAt: daysAgo(d),
      unitPrice: p,
      qty: '20',
    });
  }
  const [a] = await db
    .insert(priceAlerts)
    .values({
      restaurantId: A.restaurantId,
      productId: A.productId,
      supplierId: A.supplierId,
      windowDays: 21,
      thresholdPct: '0.1000',
      startPrice: '6.2000',
      endPrice: '7.3400',
      pctChange: '0.1806',
      startAt: daysAgo(20),
      endAt: daysAgo(1),
      observations: 5,
      dedupeKey: 'atk',
    })
    .returning();
  alertA = a!.id;
});

afterAll(async () => {
  await resetDb(db);
});

describe('W2-12 attacks: tenant B against A', () => {
  it('contracts.queue: B sees none of A’s lines, alerts or ₪', async () => {
    const q = await as(B).contracts.queue();
    expect(q.items).toEqual([]);
    expect(q.totalOverAgorot).toBe(0);
    expect(JSON.stringify(q)).not.toContain(A.supplierId);
    expect(JSON.stringify(q)).not.toContain(alertA);
  });

  it('contracts.priceContext: A’s supplier/product → NOT_FOUND', async () => {
    await expect(as(B).contracts.priceContext({ supplierId: A.supplierId, productId: A.productId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(B).contracts.priceContext({ supplierId: B.supplierId, productId: A.productId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('contracts.lockCurrentPrices: A’s supplier → NOT_FOUND (dry run and write), A unchanged', async () => {
    const before = await snapshotA();
    await expect(as(B).contracts.lockCurrentPrices({ supplierId: A.supplierId, dryRun: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(B).contracts.lockCurrentPrices({ supplierId: A.supplierId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // B locking its OWN supplier never reads A's price history.
    const own = await as(B).contracts.lockCurrentPrices({ supplierId: B.supplierId, dryRun: true });
    expect(own.count).toBe(0);
    expect(await snapshotA()).toEqual(before);
  });

  it('contracts.adoptPrice: A’s supplier or product → NOT_FOUND, A unchanged', async () => {
    const before = await snapshotA();
    await expect(as(B).contracts.adoptPrice({ supplierId: A.supplierId, productId: A.productId, contractPrice: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(as(B).contracts.adoptPrice({ supplierId: B.supplierId, productId: A.productId, contractPrice: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await snapshotA()).toEqual(before);
  });

  it('contracts.importDiff: A’s supplier → NOT_FOUND; B’s own diff never shows A’s contract price', async () => {
    await expect(
      as(B).contracts.importDiff({ supplierId: A.supplierId, file, mapping, defaultValidFrom: '2026-11-08' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const d = await as(B).contracts.importDiff({ supplierId: B.supplierId, file: { filename: 'p.csv', text: 'תיאור,מחיר חוזה\nעגבניה A,9.90\n' }, mapping, defaultValidFrom: '2026-11-08' });
    // "עגבניה A" is A's product name: B can't resolve it → unmatched, no current price.
    expect(d.rows[0]).toMatchObject({ chip: 'unmatched', currentPrice: null, productId: null });
  });

  it('contracts.importCommit with excludeRowIds: A’s supplier → NOT_FOUND, A unchanged', async () => {
    const before = await snapshotA();
    await expect(
      as(B).contracts.importCommit({ supplierId: A.supplierId, file, mapping, defaultValidFrom: '2026-11-08', excludeRowIds: [3] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await snapshotA()).toEqual(before);
  });

  it('priceAlerts.previewThreshold: B counts only its own history; A’s supplier → NOT_FOUND', async () => {
    const own = await as(B).priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.1, windowDays: 21 });
    expect(own.count).toBe(0);
    await expect(
      as(B).priceAlerts.previewThreshold({ supplierId: A.supplierId, category: null, thresholdPct: 0.1, windowDays: 21 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('priceAlerts.dismiss (with reason) and reopen: A’s alert → NOT_FOUND, A unchanged', async () => {
    const before = await snapshotA();
    await expect(as(B, 'manager').priceAlerts.dismiss({ id: alertA, reason: 'other' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await snapshotA()).toEqual(before);
    await as(A, 'manager').priceAlerts.dismiss({ id: alertA });
    const dismissed = await snapshotA();
    await expect(as(B, 'manager').priceAlerts.reopen({ id: alertA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await snapshotA()).toEqual(dismissed);
  });

  it('contracts.delete (the adopt undo) of A’s row from B → NOT_FOUND', async () => {
    await expect(as(B, 'manager').contracts.delete({ id: contractA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('W2-12 attacks: receiver and chef are FORBIDDEN on every new or changed procedure', () => {
  for (const role of ['receiver', 'chef'] as const) {
    it(`${role}`, async () => {
      const c = as(A, role);
      const calls: Array<() => Promise<unknown>> = [
        () => c.contracts.queue(),
        () => c.contracts.priceContext({ supplierId: A.supplierId, productId: A.productId }),
        () => c.contracts.lockCurrentPrices({ supplierId: A.supplierId, dryRun: true }),
        () => c.contracts.adoptPrice({ supplierId: A.supplierId, productId: A.productId, contractPrice: 1 }),
        () => c.contracts.importDiff({ supplierId: A.supplierId, file, mapping, defaultValidFrom: '2026-11-08' }),
        () => c.contracts.importCommit({ supplierId: A.supplierId, file, mapping, defaultValidFrom: '2026-11-08', excludeRowIds: [2] }),
        () => c.priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.1, windowDays: 21 }),
        () => c.priceAlerts.dismiss({ id: alertA, reason: 'other' }),
        () => c.priceAlerts.reopen({ id: alertA }),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  }

  it('bookkeeper reads (queue, priceContext, previewThreshold) but every write is FORBIDDEN', async () => {
    const c = as(A, 'bookkeeper');
    await expect(c.contracts.queue()).resolves.toBeTruthy();
    await expect(c.contracts.priceContext({ supplierId: A.supplierId, productId: A.productId })).resolves.toBeTruthy();
    await expect(c.priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.1, windowDays: 21 })).resolves.toBeTruthy();
    await expect(c.contracts.importDiff({ supplierId: A.supplierId, file, mapping, defaultValidFrom: '2026-11-08' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.priceAlerts.reopen({ id: alertA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
