import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, priceHistory, products, restaurants, suppliers, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { dishPriceAlerts, type ChangeRowLike } from '../recipes/alerts';
import { startOfMonthInTz } from '../routers/recipes';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** Dish price alerts (flag `dishPriceAlert` on top of `recipes`). */

const row = (over: Partial<ChangeRowLike> = {}): ChangeRowLike => ({
  recipeId: 'r', name: 'סטייק', nameEn: 'Steak', isSubRecipe: false, active: true,
  beforeFoodCostBp: 2900, afterFoodCostBp: 3100, costDeltaAgorot: 340,
  driver: { kind: 'product', name: 'אנטריקוט', nameEn: 'Entrecôte', unit: 'ק״ג', deltaAgorot: 340, priceBefore: '139.0000', priceNow: '149.0000', supplier: { id: 's', name: 'קצביית הכרם', nameEn: 'HaKerem' } },
  ...over,
});

describe('dishPriceAlerts (pure rule)', () => {
  it('alerts when the dish crossed the target because a paid price rose — with ₪/plate, price move and supplier', () => {
    const [a] = dishPriceAlerts([row()], 3000);
    expect(a).toMatchObject({
      costDeltaAgorot: 340,
      product: { priceDeltaAgorot: 1000, priceChangeBp: 719 }, // (149 − 139) / 139 = 7.19%
      supplier: { name: 'קצביית הכרם' },
    });
  });

  it('does not alert when the dish did not CROSS the target this month', () => {
    expect(dishPriceAlerts([row({ beforeFoodCostBp: 3100, afterFoodCostBp: 3300 })], 3000)).toEqual([]); // already over
    expect(dishPriceAlerts([row({ afterFoodCostBp: 3000 })], 3000)).toEqual([]); // at target, not over
    expect(dishPriceAlerts([row({ beforeFoodCostBp: 3100, afterFoodCostBp: 2900 })], 3000)).toEqual([]); // got better
  });

  it('does not alert for sub-recipes, inactive dishes, no menu price, or a move not caused by a price rise', () => {
    expect(dishPriceAlerts([row({ isSubRecipe: true })], 3000)).toEqual([]);
    expect(dishPriceAlerts([row({ active: false })], 3000)).toEqual([]);
    expect(dishPriceAlerts([row({ beforeFoodCostBp: null })], 3000)).toEqual([]);
    expect(dishPriceAlerts([row({ driver: { ...row().driver!, kind: 'subRecipe' } })], 3000)).toEqual([]);
    expect(dishPriceAlerts([row({ driver: { ...row().driver!, priceNow: '139.0000' } })], 3000)).toEqual([]); // recipe edit, not a price rise
    expect(dishPriceAlerts([row({ driver: null })], 3000)).toEqual([]);
  });

  it('orders by ₪ per plate, biggest first', () => {
    const res = dishPriceAlerts([row({ recipeId: 'a', costDeltaAgorot: 100 }), row({ recipeId: 'b', costDeltaAgorot: 900 })], 3000);
    expect(res.map((r) => r.recipeId)).toEqual(['b', 'a']);
  });
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const setFlags = (rid: string, f: Record<string, boolean>) =>
  db.update(restaurants).set({ settings: { features: f } as unknown as RestaurantSettings }).where(eq(restaurants.id, rid));
const DAY = 86_400_000;

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'AL');
  B = await seedTenant(db, 'BL');
  const monthStart = startOfMonthInTz(new Date(), 'Asia/Jerusalem');
  for (const t of [A, B]) {
    const [p] = await db.insert(products).values({ restaurantId: t.restaurantId, canonicalName: 'אנטריקוט', nameEn: 'Entrecôte', defaultUnit: 'ק״ג' }).returning();
    // ₪139/kg last month, ₪149/kg this month (A's supplier); B's price never moved.
    await db.insert(priceHistory).values([
      { restaurantId: t.restaurantId, productId: p!.id, supplierId: t.supplierId, observedAt: new Date(monthStart.getTime() - 5 * DAY), unitPrice: '139.0000' },
      ...(t === A ? [{ restaurantId: t.restaurantId, productId: p!.id, supplierId: t.supplierId, observedAt: new Date(monthStart.getTime() + 60_000), unitPrice: '149.0000' }] : []),
    ]);
    await setFlags(t.restaurantId, { recipes: true, dishPriceAlert: true });
    // 300 g, 12% trim: before 0.3/0.88 × 139 = 47.39 → after 50.80; ₪199 incl. VAT → net 168.64 → 28.1% → 30.1%.
    await caller(t).recipes.save({ name: 'סטייק', nameEn: 'Steak', menuPriceAgorot: 19900, items: [{ productId: p!.id, quantity: '300', unit: 'גרם', wastePct: 12 }] });
  }
});

afterAll(async () => {
  await resetDb(db);
});

describe('recipes.priceAlerts', () => {
  it("raises A's steak alert with the supplier who charged the new price", async () => {
    const res = await caller(A).recipes.priceAlerts();
    expect(res.enabled).toBe(true);
    expect(res.alerts).toHaveLength(1);
    const [supA] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, A.supplierId));
    expect(res.alerts[0]).toMatchObject({
      name: 'סטייק',
      beforeFoodCostBp: 2810,
      afterFoodCostBp: 3012,
      costDeltaAgorot: 5080 - 4739,
      product: { priceBefore: '139.0000', priceNow: '149.0000', priceChangeBp: 719 },
      supplier: { id: A.supplierId, name: supA!.name },
    });
  });

  it("isolation: B (same dish, flat price) has no alert and never sees A's", async () => {
    const res = await caller(B).recipes.priceAlerts();
    expect(res).toMatchObject({ enabled: true, alerts: [] });
  });

  it('flag off ⇒ { enabled: false, alerts: [] } (no error); recipes flag off ⇒ FORBIDDEN like every recipes procedure', async () => {
    await setFlags(A.restaurantId, { recipes: true });
    expect(await caller(A).recipes.priceAlerts()).toMatchObject({ enabled: false, alerts: [] });
    process.env.FEATURES_OFF = 'dishPriceAlert';
    try {
      await setFlags(A.restaurantId, { recipes: true, dishPriceAlert: true });
      expect(await caller(A).recipes.priceAlerts()).toMatchObject({ enabled: false });
    } finally {
      delete process.env.FEATURES_OFF;
    }
    await setFlags(A.restaurantId, { dishPriceAlert: true });
    await expect(caller(A).recipes.priceAlerts()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setFlags(A.restaurantId, { recipes: true, dishPriceAlert: true });
  });

  it('roles: chef/manager see alerts; receiver/bookkeeper are FORBIDDEN', async () => {
    for (const role of ['chef', 'manager'] as const) await expect(caller(A, role).recipes.priceAlerts()).resolves.toMatchObject({ enabled: true });
    for (const role of ['receiver', 'bookkeeper'] as const) await expect(caller(A, role).recipes.priceAlerts()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('recipes.changes now names the supplier of the driving price (additive field)', async () => {
    const ch = await caller(A).recipes.changes();
    expect(ch.rows[0]!.driver).toMatchObject({ kind: 'product', supplier: { id: A.supplierId } });
  });
});
