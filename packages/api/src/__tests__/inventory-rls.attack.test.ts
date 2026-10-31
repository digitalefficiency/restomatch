import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  inventoryCountLines,
  inventoryCounts,
  priceHistory,
  products,
  restaurants,
  testDbUrl,
  withRestaurant,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * RLS backstop for inventory counts (0070): connected as `restomatch_app` (a
 * non-owner role that cannot bypass RLS), the database itself keeps each
 * restaurant's counts and lines to that restaurant — even for raw queries that
 * skip the app layer — and the router works end to end through that role.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let aCount: string;
let bCount: string;

const callerFor = (t: Tenant, db: Database) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  A = await seedTenant(ownerDb, 'RA');
  B = await seedTenant(ownerDb, 'RB');
  for (const [t, name] of [[A, 'a'], [B, 'b']] as const) {
    const [c] = await ownerDb
      .insert(inventoryCounts)
      .values({ restaurantId: t.restaurantId, countDate: '2026-10-01', status: 'completed', completedAt: new Date(), totalValueAgorot: 100 })
      .returning();
    await ownerDb.insert(inventoryCountLines).values({ restaurantId: t.restaurantId, countId: c!.id, productId: t.productId, qty: '1', unit: 'ק״ג', valueAgorot: 100, unitCost: '1.0000' });
    if (name === 'a') aCount = c!.id;
    else bCount = c!.id;
  }
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('inventory_counts / inventory_count_lines (0070) are tenant-isolated under the app role', () => {
  it('GUC=A sees only tenant-A counts and lines; no GUC sees none', async () => {
    const [c, l] = await withRestaurant(appDb, A.restaurantId, async (tx) => [
      await tx.select({ rid: inventoryCounts.restaurantId }).from(inventoryCounts),
      await tx.select({ rid: inventoryCountLines.restaurantId }).from(inventoryCountLines),
    ]);
    expect(c!.map((x) => x.rid)).toEqual([A.restaurantId]);
    expect(l!.map((x) => x.rid)).toEqual([A.restaurantId]);
    expect(await appDb.select({ id: inventoryCounts.id }).from(inventoryCounts)).toEqual([]);
    expect(await appDb.select({ id: inventoryCountLines.id }).from(inventoryCountLines)).toEqual([]);
  });

  it('blocks a cross-tenant INSERT, and UPDATE/DELETE of B rows match nothing', async () => {
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) => tx.insert(inventoryCounts).values({ restaurantId: B.restaurantId, countDate: '2026-10-02' })),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withRestaurant(appDb, A.restaurantId, (tx) =>
        tx.insert(inventoryCountLines).values({ restaurantId: B.restaurantId, countId: bCount, productId: B.productId, unit: 'ק״ג', qty: '9' }),
      ),
    ).rejects.toThrow(/row-level security/);
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.update(inventoryCounts).set({ totalValueAgorot: 0 }).where(eq(inventoryCounts.id, bCount)).returning({ id: inventoryCounts.id }),
    );
    expect(updated).toEqual([]);
    const deleted = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx.delete(inventoryCountLines).where(eq(inventoryCountLines.countId, bCount)).returning({ id: inventoryCountLines.id }),
    );
    expect(deleted).toEqual([]);
  });

  it('the same-tenant composite FK rejects an A line pointing at B’s count or product (even as owner)', async () => {
    await expect(
      ownerDb.insert(inventoryCountLines).values({ restaurantId: A.restaurantId, countId: bCount, productId: A.productId, unit: 'ק״ג' }),
    ).rejects.toThrow();
    await expect(
      ownerDb.insert(inventoryCountLines).values({ restaurantId: A.restaurantId, countId: aCount, productId: B.productId, unit: 'ק״ג' }),
    ).rejects.toThrow();
  });

  it('the inventory router works through the app role once the flag is on (grants + GUC wiring)', async () => {
    await ownerDb.update(restaurants).set({ settings: { features: { inventoryCount: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, A.restaurantId));
    // The shared fixture also prices this product (₪8.50 at 11:00 today), which is "newer" than now
    // before 11:00 — so this test owns the product's only paid price, whatever the clock says.
    await ownerDb.delete(priceHistory).where(and(eq(priceHistory.restaurantId, A.restaurantId), eq(priceHistory.productId, A.productId)));
    await ownerDb.insert(priceHistory).values({ restaurantId: A.restaurantId, productId: A.productId, supplierId: A.supplierId, observedAt: new Date(), unitPrice: '2.0000' });
    const hist = await callerFor(A, appDb).inventory.history();
    expect(hist.map((h) => h.id)).toEqual([aCount]);
    const d = await callerFor(A, appDb).inventory.start();
    await callerFor(A, appDb).inventory.saveLines({ countId: d.id, lines: [{ productId: A.productId, qty: '3' }] });
    const done = await callerFor(A, appDb).inventory.complete({ countId: d.id });
    expect(done.totalValueAgorot).toBe(600);
    await expect(callerFor(A, appDb).inventory.get({ countId: bCount })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('inventory router: a foreign count id or product never reaches another tenant (app role)', () => {
  let aDraft: string;
  beforeAll(async () => {
    await ownerDb.update(restaurants).set({ settings: { features: { inventoryCount: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, B.restaurantId));
    const cur = await callerFor(A, appDb).inventory.current();
    aDraft = cur?.id ?? (await callerFor(A, appDb).inventory.start()).id;
  });

  it("saveLines / complete on A's draft from B → NOT_FOUND, and A's draft is untouched", async () => {
    await expect(callerFor(B, appDb).inventory.saveLines({ countId: aDraft, lines: [{ productId: B.productId, qty: '9' }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(callerFor(B, appDb).inventory.complete({ countId: aDraft, acceptUncounted: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await ownerDb.select().from(inventoryCounts).where(eq(inventoryCounts.id, aDraft));
    expect(row).toMatchObject({ restaurantId: A.restaurantId, status: 'draft' });
    const lines = await ownerDb.select().from(inventoryCountLines).where(eq(inventoryCountLines.countId, aDraft));
    expect(lines.every((l) => l.restaurantId === A.restaurantId && l.productId !== B.productId)).toBe(true);
  });

  it("searchProducts from B never returns A's product, even by its exact name", async () => {
    const [aProduct] = await ownerDb.select({ name: products.canonicalName }).from(products).where(eq(products.id, A.productId));
    const found = await callerFor(B, appDb).inventory.searchProducts({ q: aProduct!.name });
    expect(found.map((p) => p.id)).not.toContain(A.productId);
  });

  it("period for A's closed count from B → notFound; B's own period never includes A's counts", async () => {
    expect(await callerFor(B, appDb).inventory.period({ closingId: aCount })).toEqual({ available: false, reason: 'notFound' });
    const own = await callerFor(B, appDb).inventory.period();
    expect(JSON.stringify(own)).not.toContain(aCount);
  });
});
