import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, priceHistory, products, recipeItems, recipes, restaurants, sql, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-02 · owner decision I3: the bookkeeper reads every recipes.* screen
 * (₪ included: she is finance) and writes nothing. Her reads stay tenant-scoped
 * (B's ids are NOT_FOUND to A's bookkeeper), every write is FORBIDDEN with no
 * row changed, and the receiver still reads nothing.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let prodA: string;
let dishA: string;
let dishB: string;

function caller(t: Tenant, role: Session['role']) {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const flagOn = (t: Tenant) =>
  db.update(restaurants).set({ settings: { features: { recipes: true } } as unknown as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));
async function snapshot() {
  const [r] = await db.select({ n: sql<number>`count(*)::int`, names: sql<string>`string_agg(name, ',' order by name)` }).from(recipes);
  const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(recipeItems);
  const [t] = await db.select({ s: sql<string>`string_agg(settings::text, ',' order by id)` }).from(restaurants);
  return { recipes: r!.n, names: r!.names, items: i!.n, settings: t!.s };
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  await Promise.all([flagOn(A), flagOn(B)]);
  const [pa] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'בצל', defaultUnit: 'ק״ג' }).returning();
  const [pb] = await db.insert(products).values({ restaurantId: B.restaurantId, canonicalName: 'בצל', defaultUnit: 'ק״ג' }).returning();
  prodA = pa!.id;
  await db.insert(priceHistory).values({ restaurantId: A.restaurantId, productId: prodA, supplierId: A.supplierId, observedAt: new Date(Date.now() - 86_400_000), unitPrice: '5.0000' });
  dishA = (await caller(A, 'chef').recipes.save({ name: 'מרק A', menuPriceAgorot: 3000, items: [{ productId: prodA, quantity: '200', unit: 'גרם', wastePct: 0 }] })).id;
  dishB = (await caller(B, 'chef').recipes.save({ name: 'מרק B', menuPriceAgorot: 3000, items: [{ productId: pb!.id, quantity: '1', unit: 'ק״ג', wastePct: 0 }] })).id;
});

afterAll(async () => {
  await db.delete(recipeItems).where(inArray(recipeItems.restaurantId, [A.restaurantId, B.restaurantId]));
  await db.delete(recipes).where(inArray(recipes.restaurantId, [A.restaurantId, B.restaurantId]));
  await resetDb(db);
});

describe('recipes.* — the bookkeeper reads, never writes (owner decision I3)', () => {
  it('reads every recipes screen of her own restaurant, ₪ included', async () => {
    const bk = caller(A, 'bookkeeper');
    const list = await bk.recipes.list();
    expect(list.recipes.map((r) => r.name)).toEqual(['מרק A']);
    expect(list.recipes[0]!.portionCostAgorot).toBe(100);
    await expect(bk.recipes.get({ id: dishA })).resolves.toMatchObject({ recipe: { id: dishA } });
    await expect(bk.recipes.changes()).resolves.toBeDefined();
    await expect(bk.recipes.priceAlerts()).resolves.toBeDefined();
    await expect(bk.recipes.subRecipes()).resolves.toBeDefined();
    await expect(bk.recipes.impact({ productId: prodA, changePct: 10 })).resolves.toBeDefined();
    await expect(bk.recipes.preview({ name: 'x', items: [{ productId: prodA, quantity: '1', unit: 'ק״ג', wastePct: 0 }] })).resolves.toMatchObject({ portionCostAgorot: 500 });
  });

  it("her reads stay tenant-scoped: B's recipe is NOT_FOUND, B's dishes never listed", async () => {
    const bk = caller(A, 'bookkeeper');
    await expect(bk.recipes.get({ id: dishB })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await bk.recipes.list()).recipes.some((r) => r.id === dishB)).toBe(false);
  });

  it('every write is FORBIDDEN and changes no row (own and foreign ids)', async () => {
    const bk = caller(A, 'bookkeeper');
    const before = await snapshot();
    const item = { productId: prodA, quantity: '1', unit: 'ק״ג', wastePct: 0 };
    await expect(bk.recipes.save({ name: 'חדש', items: [item] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.save({ id: dishA, name: 'שונה', items: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.save({ id: dishB, name: 'hijack', items: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.delete({ id: dishA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.delete({ id: dishB })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.setTarget({ targetPct: 40 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(bk.recipes.importCsv({ csv: 'dish,ingredient,qty,unit\nמנה,בצל,1,ק״ג', dryRun: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await snapshot()).toEqual(before);
  });

  it('the receiver still reads nothing', async () => {
    await expect(caller(A, 'receiver').recipes.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(A, 'receiver').recipes.get({ id: dishA })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
