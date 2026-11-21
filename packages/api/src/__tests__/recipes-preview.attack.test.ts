import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, priceHistory, products, recipeItems, recipes, restaurants, sql, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-02 · recipes.preview, cross-tenant: A's draft can never cost (or confirm
 * the existence of) B's recipe, product or sub-recipe; the preview never
 * writes; flag + role gates match the rest of recipes.*.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let prodA: string;
let prodB: string;
let subA: string;
let subB: string;
let dishA: string;
let dishB: string;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const setFlag = (t: Tenant, on: boolean) =>
  db.update(restaurants).set({ settings: (on ? { features: { recipes: true } } : {}) as unknown as RestaurantSettings }).where(eq(restaurants.id, t.restaurantId));

const draft = (items: { productId?: string; subRecipeId?: string; quantity: string; unit: string }[], id?: string) => ({
  id,
  name: 'טיוטה',
  menuPriceAgorot: 5900,
  items: items.map((i) => ({ ...i, wastePct: 0 })),
});

async function counts() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(recipes);
  const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(recipeItems);
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(products);
  const [h] = await db.select({ n: sql<number>`count(*)::int` }).from(priceHistory);
  return { recipes: r!.n, items: i!.n, products: p!.n, priceHistory: h!.n };
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  await Promise.all([setFlag(A, true), setFlag(B, true)]);
  const [pa] = await db.insert(products).values({ restaurantId: A.restaurantId, canonicalName: 'עגבנייה', defaultUnit: 'ק״ג' }).returning();
  const [pb] = await db.insert(products).values({ restaurantId: B.restaurantId, canonicalName: 'עגבנייה', defaultUnit: 'ק״ג' }).returning();
  prodA = pa!.id;
  prodB = pb!.id;
  await db.insert(priceHistory).values([
    { restaurantId: A.restaurantId, productId: prodA, supplierId: A.supplierId, observedAt: new Date(Date.now() - 86_400_000), unitPrice: '8.0000' },
    { restaurantId: B.restaurantId, productId: prodB, supplierId: B.supplierId, observedAt: new Date(Date.now() - 86_400_000), unitPrice: '99.0000' },
  ]);
  subA = (await caller(A).recipes.save({ name: 'רוטב A', isSubRecipe: true, yieldUnit: 'ק״ג', items: [{ productId: prodA, quantity: '1', unit: 'ק״ג', wastePct: 0 }] })).id;
  subB = (await caller(B).recipes.save({ name: 'רוטב B', isSubRecipe: true, yieldUnit: 'ק״ג', items: [{ productId: prodB, quantity: '1', unit: 'ק״ג', wastePct: 0 }] })).id;
  dishA = (await caller(A).recipes.save({ name: 'מנה A', menuPriceAgorot: 5900, items: [{ productId: prodA, quantity: '100', unit: 'גרם', wastePct: 0 }] })).id;
  dishB = (await caller(B).recipes.save({ name: 'מנה B', menuPriceAgorot: 9900, items: [{ subRecipeId: subB, quantity: '100', unit: 'גרם', wastePct: 0 }] })).id;
});

beforeEach(async () => {
  await Promise.all([setFlag(A, true), setFlag(B, true)]);
});

afterAll(async () => {
  await db.delete(recipeItems).where(inArray(recipeItems.restaurantId, [A.restaurantId, B.restaurantId]));
  await db.delete(recipes).where(inArray(recipes.restaurantId, [A.restaurantId, B.restaurantId]));
  await resetDb(db);
});

describe('recipes.preview — cross-tenant', () => {
  it("costs A's own draft from A's prices (₪8/kg × 250 g = ₪2.00), sub-recipe included", async () => {
    const p = await caller(A, 'chef').recipes.preview(draft([{ productId: prodA, quantity: '200', unit: 'גרם' }, { subRecipeId: subA, quantity: '50', unit: 'גרם' }]));
    expect(p.portionCostAgorot).toBe(200);
    expect(p.lines.map((l) => l.costAgorot)).toEqual([160, 40]);
    expect(p.lines.map((l) => l.shareBp)).toEqual([8000, 2000]);
  });

  it("B's product id in A's draft → NOT_FOUND (never costed at B's ₪99)", async () => {
    await expect(caller(A).recipes.preview(draft([{ productId: prodB, quantity: '1', unit: 'ק״ג' }]))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'recipes.productNotFound',
    });
  });

  it("B's sub-recipe id in A's draft → NOT_FOUND", async () => {
    await expect(caller(A).recipes.preview(draft([{ subRecipeId: subB, quantity: '1', unit: 'ק״ג' }]))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'recipes.subRecipeNotFound',
    });
  });

  it("B's recipe id as the draft id → NOT_FOUND, the same answer as an unknown id", async () => {
    const e1 = await caller(A).recipes.preview(draft([], dishB)).catch((e) => e);
    const e2 = await caller(A).recipes.preview(draft([], '00000000-0000-4000-8000-000000000000')).catch((e) => e);
    expect([e1.code, e1.message]).toEqual(['NOT_FOUND', 'recipes.notFound']);
    expect([e2.code, e2.message]).toEqual([e1.code, e1.message]);
  });

  it('a dish used as a sub-recipe → BAD_REQUEST notSubRecipe', async () => {
    await expect(caller(A).recipes.preview(draft([{ subRecipeId: dishA, quantity: '1', unit: 'מנה' }]))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'recipes.notSubRecipe',
    });
  });

  it('never writes: recipes, recipe_items, products and price_history are unchanged after previews (new and existing id)', async () => {
    const before = await counts();
    await caller(A).recipes.preview(draft([{ productId: prodA, quantity: '1', unit: 'ק״ג' }]));
    await caller(A).recipes.preview({ ...draft([{ productId: prodA, quantity: '3', unit: 'ק״ג' }], dishA), name: 'שם אחר' });
    expect(await counts()).toEqual(before);
    const [row] = await db.select().from(recipes).where(eq(recipes.id, dishA));
    expect(row!.name).toBe('מנה A');
  });

  it('flag off → FORBIDDEN; receiver → FORBIDDEN; chef, manager and the bookkeeper (I3, a read) allowed', async () => {
    await setFlag(A, false);
    await expect(caller(A).recipes.preview(draft([]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFlag(A, true);
    for (const role of ['receiver'] as const) await expect(caller(A, role).recipes.preview(draft([]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const role of ['chef', 'manager', 'bookkeeper'] as const) await expect(caller(A, role).recipes.preview(draft([]))).resolves.toBeDefined();
  });
});
