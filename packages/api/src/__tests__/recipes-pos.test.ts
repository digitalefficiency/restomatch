import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, products, restaurants, sql, testDbUrl, priceHistory, type RestaurantSettings } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { posVsTheory, matchPosItems } from '../recipes/pos';
import type { RecipeCost } from '../recipes/cost';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Theoretical vs actual food cost per dish from POS sales (recipes + integrations
 * flags). The POS table is S5's `pos_sales` (migration 0058, not on this branch):
 * the suite creates the same shape when the DB doesn't have it yet, and drops it
 * only if it created it.
 */

const cost = (portion: number, foodCostBp: number | null): RecipeCost => ({
  recipeId: 'x', batchCostAgorot: portion, portionCostAgorot: portion, netMenuPriceAgorot: null,
  foodCostBp, grossMarginAgorot: null, complete: true, lines: [],
});

describe('posVsTheory (pure)', () => {
  const recipes = [
    { id: 's', name: 'שניצל', nameEn: 'Schnitzel', isSubRecipe: false },
    { id: 'h', name: 'חומוס', nameEn: null, isSubRecipe: false },
    { id: 'sauce', name: 'טחינה', nameEn: null, isSubRecipe: true },
  ];
  it('matches POS items by ref or name, Hebrew or English, case/space-insensitively; never to a sub-recipe', () => {
    const m = matchPosItems(
      [
        { itemRef: 'SCH-1', itemName: '  schnitzel ', qty: '1', netAmount: '1' },
        { itemRef: 'חומוס', itemName: 'Hummus plate', qty: '1', netAmount: '1' },
        { itemRef: 'T', itemName: 'טחינה', qty: '1', netAmount: '1' },
      ],
      recipes,
    );
    expect([...m.keys()].sort()).toEqual(['h', 's']);
  });

  it('computes cost of the sold mix and food cost on actual sales, half-up, with the gap vs the menu', () => {
    const res = posVsTheory(
      [
        { itemRef: 'SCH', itemName: 'Schnitzel', qty: '40.000', netAmount: '2100.00' }, // discounted: ₪52.50 avg
        { itemRef: 'HUM', itemName: 'חומוס', qty: '3', netAmount: '0.00' }, // comped
        { itemRef: 'COLA', itemName: 'Cola', qty: '10', netAmount: '120.00' },
      ],
      recipes,
      new Map([
        ['s', cost(1305, 2264)],
        ['h', cost(574, 1613)],
      ]),
    );
    const s = res.rows.find((r) => r.recipeId === 's')!;
    expect(s.theoreticalCostAgorot).toBe(52200); // 1305 × 40
    expect(s.avgNetPriceAgorot).toBe(5250);
    expect(s.actualFoodCostBp).toBe(2486); // 52200 / 210000 = 24.857% → 2486
    expect(s.gapBp).toBe(2486 - 2264);
    const h = res.rows.find((r) => r.recipeId === 'h')!;
    expect(h.actualFoodCostBp).toBeNull(); // ₪0 sales: no division, no fake %
    expect(h.theoreticalCostAgorot).toBe(1722);
    expect(res.totals).toEqual({ netSalesAgorot: 210000, theoreticalCostAgorot: 53922, foodCostBp: 2568 });
    expect(res.unmatched).toEqual([{ itemRef: 'COLA', itemName: 'Cola', netSalesAgorot: 12000 }]);
  });

  it('handles fractional quantities exactly (half-up once)', () => {
    const res = posVsTheory([{ itemRef: 'S', itemName: 'Schnitzel', qty: '0.500', netAmount: '10.00' }], recipes, new Map([['s', cost(3, null)]]));
    expect(res.rows[0]!.theoreticalCostAgorot).toBe(2); // 1.5 → 2
    expect(res.rows[0]!.gapBp).toBeNull();
  });
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let createdPosTable = false;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const flags = (rid: string, f: Record<string, boolean>) =>
  db.update(restaurants).set({ settings: { features: f } as unknown as RestaurantSettings }).where(eq(restaurants.id, rid));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'PA');
  B = await seedTenant(db, 'PB');
  const [reg] = (await db.execute(sql`select to_regclass('public.pos_sales')::text as t`)) as unknown as Array<{ t: string | null }>;
  if (!reg?.t) {
    createdPosTable = true;
    await db.execute(sql`create table pos_sales (
      id uuid primary key default gen_random_uuid(),
      restaurant_id uuid not null references restaurants(id) on delete cascade,
      sold_on date not null, item_ref varchar(64) not null, item_name text not null,
      qty numeric(12,3) not null, net_amount numeric(12,2) not null)`);
  }
  for (const t of [A, B]) {
    const [p] = await db.insert(products).values({ restaurantId: t.restaurantId, canonicalName: 'חזה עוף', defaultUnit: 'ק״ג' }).returning();
    await db.insert(priceHistory).values({ restaurantId: t.restaurantId, productId: p!.id, supplierId: t.supplierId, observedAt: new Date(), unitPrice: '40.0000' });
    await flags(t.restaurantId, { recipes: true, integrations: true });
    await caller(t).recipes.save({ name: 'שניצל', nameEn: 'Schnitzel', menuPriceAgorot: 5900, items: [{ productId: p!.id, quantity: '250', unit: 'גרם', wastePct: 0 }] });
  }
  await db.execute(sql`insert into pos_sales (restaurant_id, sold_on, item_ref, item_name, qty, net_amount) values
    (${A.restaurantId}, ${today()}::date, 'SCH', 'Schnitzel', 20, 900.00),
    (${A.restaurantId}, ${today()}::date, 'COLA', 'Cola', 5, 50.00),
    (${B.restaurantId}, ${today()}::date, 'SCH', 'Schnitzel', 999, 1.00)`);
});

afterAll(async () => {
  if (createdPosTable) await db.execute(sql`drop table if exists pos_sales`);
  else await db.execute(sql`delete from pos_sales where restaurant_id in (${A.restaurantId}, ${B.restaurantId})`);
  await resetDb(db);
});

describe('recipes.posVsTheory', () => {
  it("returns A's dish with A's sales only (isolation), and the unlinked POS items", async () => {
    const res = await caller(A).recipes.posVsTheory();
    expect(res.available).toBe(true);
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0]!;
    expect(r.qtySold).toBe(20); // never B's 999
    expect(r.netSalesAgorot).toBe(90000);
    expect(r.theoreticalCostAgorot).toBe(1000 * 20); // 0.25 kg × ₪40 = ₪10 per plate
    expect(r.actualFoodCostBp).toBe(2222);
    expect(res.unmatchedCount).toBe(1);
    expect(res.unmatched[0]).toMatchObject({ itemRef: 'COLA' });
  });

  it('is a neutral empty state when integrations is off or there is no POS data — never an error', async () => {
    await flags(A.restaurantId, { recipes: true });
    expect(await caller(A).recipes.posVsTheory()).toMatchObject({ available: false, reason: 'integrationsOff', rows: [] });
    await flags(A.restaurantId, { recipes: true, integrations: true });
    expect(await caller(A).recipes.posVsTheory({ month: 'previous' })).toMatchObject({ available: false, reason: 'noPosData' });
  });

  it('is FORBIDDEN without the recipes flag, and for roles that cannot see recipes', async () => {
    await flags(A.restaurantId, { integrations: true });
    await expect(caller(A).recipes.posVsTheory()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await flags(A.restaurantId, { recipes: true, integrations: true });
    for (const role of ['receiver', 'bookkeeper'] as const) {
      await expect(caller(A, role).recipes.posVsTheory()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(caller(A, 'chef').recipes.posVsTheory()).resolves.toMatchObject({ available: true });
  });
});
