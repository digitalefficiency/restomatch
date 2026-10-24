import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoiceLines, priceHistory, products, restaurants, testDbUrl, type RestaurantSettings } from '@restomatch/db';
import { writePriceHistoryForInvoice } from '../match/priceHistory';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { startOfMonthInTz } from '../routers/recipes';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * recipes router (wave 1, flag `recipes`): flag gate, role gate, costing from
 * the latest paid price, price-change impact, "what changed this month",
 * validation (foreign / cyclic / unit-mismatched lines) and the CSV import.
 */
const db = createDb(testDbUrl());
let T: Tenant;
let chicken: string;
let flour: string;
let eggs: string;

function caller(role: Session['role'] = 'owner', tenant: Tenant = T) {
  const ctx: AppContext = { db, session: { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFeatures(restaurantId: string, features: Record<string, boolean> | null) {
  await db.update(restaurants).set({ settings: (features ? { features } : {}) as unknown as RestaurantSettings }).where(eq(restaurants.id, restaurantId));
}

const DAY = 86_400_000;

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'R');
  const monthStart = startOfMonthInTz(new Date(), 'Asia/Jerusalem');
  const [c] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'חזה עוף', nameEn: 'Chicken breast', defaultUnit: 'ק״ג' }).returning();
  const [f] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'קמח', nameEn: 'Flour', defaultUnit: 'ק״ג' }).returning();
  const [e] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'ביצים', nameEn: 'Eggs', defaultUnit: 'תבנית' }).returning();
  chicken = c!.id;
  flour = f!.id;
  eggs = e!.id;
  // Chicken: ₪38.90 before this month, ₪43.57 now (+12%). Flour unchanged.
  await db.insert(priceHistory).values([
    { restaurantId: T.restaurantId, productId: chicken, supplierId: T.supplierId, observedAt: new Date(monthStart.getTime() - 5 * DAY), unitPrice: '38.9000' },
    { restaurantId: T.restaurantId, productId: chicken, supplierId: T.supplierId, observedAt: new Date(monthStart.getTime() + 60_000), unitPrice: '43.5680' },
    { restaurantId: T.restaurantId, productId: flour, supplierId: T.supplierId, observedAt: new Date(monthStart.getTime() - 9 * DAY), unitPrice: '4.9200' },
    { restaurantId: T.restaurantId, productId: eggs, supplierId: T.supplierId, observedAt: new Date(monthStart.getTime() - 9 * DAY), unitPrice: '34.0000' },
  ]);
});

beforeEach(async () => {
  await setFeatures(T.restaurantId, { recipes: true });
});

afterAll(async () => {
  await resetDb(db);
});

describe('recipes: feature flag + roles', () => {
  it('is FORBIDDEN with appCode FEATURE_DISABLED when the flag is off; enabled() reports it', async () => {
    await setFeatures(T.restaurantId, null);
    expect(await caller().recipes.enabled()).toEqual({ enabled: false });
    await expect(caller().recipes.list()).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'FEATURE_DISABLED' } });
    await setFeatures(T.restaurantId, { all: true });
    expect(await caller().recipes.enabled()).toEqual({ enabled: true });
    await setFeatures(T.restaurantId, { all: true, recipes: false });
    await expect(caller().recipes.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('honours the FEATURES_OFF kill-switch', async () => {
    process.env.FEATURES_OFF = 'recipes';
    try {
      await expect(caller().recipes.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      delete process.env.FEATURES_OFF;
    }
  });

  it('chef/manager may read + edit; receiver/bookkeeper may not; target is manager+', async () => {
    for (const role of ['owner', 'manager', 'chef'] as const) await expect(caller(role).recipes.list()).resolves.toBeDefined();
    for (const role of ['receiver', 'bookkeeper'] as const) await expect(caller(role).recipes.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('chef').recipes.setTarget({ targetPct: 28 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('recipes: costing', () => {
  let schnitzel: string;
  let batter: string;

  it('costs a dish with a sub-recipe from the latest paid prices, nets VAT and lights it', async () => {
    batter = (await caller('chef').recipes.save({
      name: 'בלילה',
      isSubRecipe: true,
      yieldQty: '1',
      yieldUnit: 'ק״ג',
      items: [
        { productId: flour, quantity: '600', unit: 'גרם', wastePct: 0 },
        { productId: eggs, quantity: '10', unit: 'יח׳', wastePct: 0, unitsPerProductUnit: '30' },
      ],
    })).id;
    schnitzel = (await caller('chef').recipes.save({
      name: 'שניצל',
      nameEn: 'Schnitzel',
      menuPriceAgorot: 3900,
      items: [
        { productId: chicken, quantity: '250', unit: 'גרם', wastePct: 8 },
        { subRecipeId: batter, quantity: '80', unit: 'גרם', wastePct: 0 },
      ],
    })).id;
    const { recipes: list, targetBp } = await caller().recipes.list();
    expect(targetBp).toBe(3000);
    const s = list.find((r) => r.id === schnitzel)!;
    // chicken 0.25/0.92 × 43.568 = 11.839 → 1184; batter batch = 0.6×4.92 (295) + 10/30×34 (1133) = 1428,
    // 80 g of a 1 kg batch = 114.24 → 114. Portion = 1298. Net menu = 3900/1.18 = 3305.08 → 3305.
    expect(s.portionCostAgorot).toBe(1184 + 114);
    expect(s.netMenuPriceAgorot).toBe(3305);
    expect(s.grossMarginAgorot).toBe(3305 - 1298);
    expect(s.foodCostBp).toBe(3927);
    expect(s.light).toBe('red');
    expect(s.complete).toBe(true);
    const b = list.find((r) => r.id === batter)!;
    expect(b.light).toBe('none');
    expect(b.batchCostAgorot).toBe(1428);

    const detail = await caller().recipes.get({ id: schnitzel });
    expect(detail.items.map((i) => [i.name, i.costAgorot, i.status])).toEqual([
      ['חזה עוף', 1184, 'ok'],
      ['בלילה', 114, 'ok'],
    ]);
  });

  it('the restaurant target moves the light (manager+), keeping other settings', async () => {
    await caller('manager').recipes.setTarget({ targetPct: 38 });
    const { recipes: list, targetBp } = await caller().recipes.list();
    expect(targetBp).toBe(3800);
    expect(list.find((r) => r.id === schnitzel)!.light).toBe('amber');
    const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, T.restaurantId));
    expect((r!.settings as { features?: unknown }).features).toEqual({ recipes: true });
    await caller('owner').recipes.setTarget({ targetPct: 30 });
  });

  it('impact: chicken +12% → the schnitzel (and not the batter) costs more, margin drops by the same', async () => {
    const res = await caller().recipes.impact({ productId: chicken, changePct: 12 });
    expect(res.changeBp).toBe(1200);
    expect(res.rows.map((r) => r.recipeId)).toEqual([schnitzel]);
    const [row] = res.rows;
    expect(row!.afterFoodCostBp!).toBeGreaterThan(row!.beforeFoodCostBp!);
    expect(row!.marginDeltaAgorot).toBe(-row!.costDeltaAgorot);
    const flourUp = await caller().recipes.impact({ productId: flour, changePct: 50 });
    expect(flourUp.rows.map((r) => r.recipeId).sort()).toEqual([batter, schnitzel].sort());
  });

  it('what changed this month: the schnitzel moved because chicken moved', async () => {
    const res = await caller().recipes.changes();
    const row = res.rows.find((r) => r.recipeId === schnitzel)!;
    // before: 0.25/0.92 × 38.90 = 10.5706 → 1057 (+ batter 114)
    expect(row.beforeCostAgorot).toBe(1057 + 114);
    expect(row.afterCostAgorot).toBe(1184 + 114);
    expect(row.costDeltaAgorot).toBe(127);
    expect(row.driver).toMatchObject({ kind: 'product', name: 'חזה עוף', priceBefore: '38.9000', priceNow: '43.5680', deltaAgorot: 127 });
    expect(res.rows.find((r) => r.recipeId === batter)).toBeUndefined();
    // The overview card counts menu dishes only and tells "no recipes yet" from "steady".
    expect(row.active).toBe(true);
    expect(res.activeDishCount).toBeGreaterThan(0);
  });

  it('rejects a duplicate name, a cycle, a dish used as a sub-recipe, and an unbridged unit mismatch', async () => {
    await expect(caller().recipes.save({ name: 'שניצל', items: [] })).rejects.toMatchObject({ code: 'CONFLICT', message: 'recipes.duplicateName' });
    await expect(
      caller().recipes.save({ id: batter, name: 'בלילה', isSubRecipe: true, yieldUnit: 'ק״ג', items: [{ subRecipeId: batter, quantity: '1', unit: 'ק״ג', wastePct: 0 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'recipes.cycle' });
    await expect(
      caller().recipes.save({ name: 'x', items: [{ subRecipeId: schnitzel, quantity: '1', unit: 'מנה', wastePct: 0 }] }),
    ).rejects.toMatchObject({ message: 'recipes.notSubRecipe' });
    await expect(
      caller().recipes.save({ name: 'y', items: [{ productId: eggs, quantity: '2', unit: 'יח׳', wastePct: 0 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'recipes.unitMismatch' });
    // A sub-recipe in use cannot be deleted or turned into a dish.
    await expect(caller().recipes.delete({ id: batter })).rejects.toMatchObject({ code: 'CONFLICT', message: 'recipes.inUse' });
    await expect(
      caller().recipes.save({ id: batter, name: 'בלילה', isSubRecipe: false, items: [] }),
    ).rejects.toMatchObject({ message: 'recipes.inUse' });
    // products.delete gives a friendly CONFLICT for a product a recipe uses.
    await expect(caller().products.delete({ productId: flour })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a product without a paid price makes the recipe incomplete, not silently cheap', async () => {
    const [p] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'זעפרן', defaultUnit: 'גרם' }).returning();
    const { id } = await caller().recipes.save({ name: 'אורז זעפרן', menuPriceAgorot: 2000, items: [{ productId: p!.id, quantity: '1', unit: 'גרם', wastePct: 0 }] });
    const r = (await caller().recipes.list()).recipes.find((x) => x.id === id)!;
    expect(r.complete).toBe(false);
    const d = await caller().recipes.get({ id });
    expect(d.items[0]!.status).toBe('missingPrice');
    await caller().recipes.delete({ id });
  });

  it('a product with no default unit is costed per its BILLED unit, never per the line unit', async () => {
    // Regression: products from the OCR mapping "new product" path have no
    // default unit, so price_history keeps the billed ₪/kg unchanged. A recipe
    // line of 150 g used to be costed 150 × ₪10 = ₪1 500 (complete, "ok").
    const [p] = await db.insert(products).values({ restaurantId: T.restaurantId, canonicalName: 'שום', nameEn: 'Garlic' }).returning();
    await db.insert(invoiceLines).values({
      invoiceId: T.invoiceId,
      productId: p!.id,
      rawDescription: 'שום קלוף',
      qtyBilled: '10',
      unit: 'ק״ג',
      unitPriceBilled: '10.0000',
      lineTotal: '100.00',
    });
    await writePriceHistoryForInvoice(db, T.restaurantId, T.invoiceId);
    const [hit] = await caller('chef').recipes.searchProducts({ search: 'garlic' });
    expect(hit).toMatchObject({ id: p!.id, unitPrice: '10.0000', unit: 'ק״ג' });

    const { id } = await caller().recipes.save({ name: 'רוטב שום', items: [{ productId: p!.id, quantity: '150', unit: 'גרם', wastePct: 0 }] });
    const d = await caller().recipes.get({ id });
    expect(d.items[0]).toMatchObject({ status: 'ok', sourceUnit: 'ק״ג' });
    expect(d.recipe.portionCostAgorot).toBe(150); // 0.15 kg × ₪10 = ₪1.50
    // A unit that does not convert to the billed kg needs the manual bridge.
    await expect(
      caller().recipes.save({ name: 'רוטב שום 2', items: [{ productId: p!.id, quantity: '2', unit: 'יח׳', wastePct: 0 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'recipes.unitMismatch' });
    await caller().recipes.delete({ id });
  });

  it('searchProducts returns the latest paid price + unit', async () => {
    const rows = await caller('chef').recipes.searchProducts({ search: 'chicken' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: chicken, unitPrice: '43.5680', unit: 'ק״ג' });
  });
});

describe('recipes: CSV import', () => {
  const csv = [
    'recipe,ingredient,quantity,unit,waste_pct,menu_price,sub_recipe,yield_qty,yield_unit,units_per_product_unit',
    'רוטב,Flour,100,גרם,,,yes,0.5,ק״ג,',
    'Pancakes,Flour,120,g,0,"₪42.50",,,,',
    ',Eggs,2,יח׳,,,,,,30',
    ',רוטב,50,גרם,,,,,,',
  ].join('\n');

  it('dry-run previews, then imports dishes + sub-recipes by Hebrew/English name', async () => {
    const dry = await caller().recipes.importCsv({ csv, dryRun: true });
    expect(dry).toMatchObject({ ok: true, errors: [], recipes: [{ name: 'רוטב', lines: 1, action: 'create' }, { name: 'Pancakes', lines: 3, action: 'create' }] });
    expect((await caller().recipes.list()).recipes.find((r) => r.name === 'Pancakes')).toBeUndefined();
    const res = await caller().recipes.importCsv({ csv, dryRun: false });
    expect(res.ok).toBe(true);
    const list = (await caller().recipes.list()).recipes;
    const pancakes = list.find((r) => r.name === 'Pancakes')!;
    expect(pancakes.menuPriceAgorot).toBe(4250);
    expect(pancakes.complete).toBe(true);
    // 0.12 × 4.92 = 59; 2/30 × 34 = 227; sauce batch 0.1×4.92 = 49 for 0.5 kg → 50 g = 4.9 → 5.
    expect(pancakes.portionCostAgorot).toBe(59 + 227 + 5);
    // Re-import replaces instead of duplicating.
    const again = await caller().recipes.importCsv({ csv, dryRun: false });
    expect(again.recipes.map((r) => r.action)).toEqual(['replace', 'replace']);
    expect((await caller().recipes.list()).recipes.filter((r) => r.name === 'Pancakes')).toHaveLength(1);
  });

  it('reports row-level errors (unknown ingredient, bad qty) and writes nothing', async () => {
    const bad = ['recipe,ingredient,quantity,unit', 'Soup,Unicorn,1,ק״ג', 'Soup,Flour,-1,ק״ג'].join('\n');
    const res = await caller().recipes.importCsv({ csv: bad, dryRun: false });
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(expect.arrayContaining([
      { row: 3, code: 'badQuantity', value: '-1' },
      { row: 2, code: 'unknownIngredient', value: 'Unicorn' },
    ]));
    expect((await caller().recipes.list()).recipes.find((r) => r.name === 'Soup')).toBeUndefined();
    const missing = await caller().recipes.importCsv({ csv: 'name,qty\nx,1', dryRun: true });
    expect(missing).toMatchObject({ ok: false, errors: [{ code: 'missingColumn' }] });
  });
});

describe('recipes: refuter regressions', () => {
  it('D1: an absurd batch is rejected at save and can never blank the list', async () => {
    const tiny = await caller().recipes.save({
      name: 'tiny', isSubRecipe: true, yieldQty: '0.0001', yieldUnit: 'מנה',
      items: [{ productId: chicken, quantity: '10', unit: 'ק״ג', wastePct: 0 }],
    });
    await expect(
      caller().recipes.save({ name: 'huge', items: [{ subRecipeId: tiny.id, quantity: '99999999', unit: 'מנה', wastePct: 95 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'recipes.tooLarge' });
    await expect(caller().recipes.list()).resolves.toBeDefined();
    await caller().recipes.delete({ id: tiny.id });
  });

  it('D2: what passes a dry run also commits — limits, nested sub-recipes, in-use subs', async () => {
    const long = `recipe,ingredient,quantity,unit\n${'x'.repeat(121)},Flour,1,ק״ג`;
    expect((await caller().recipes.importCsv({ csv: long, dryRun: true })).errors[0]).toMatchObject({ code: 'tooLong' });
    const pricey = `recipe,ingredient,quantity,unit,menu_price\nGold,Flour,1,ק״ג,250000`;
    expect((await caller().recipes.importCsv({ csv: pricey, dryRun: true })).errors[0]).toMatchObject({ code: 'badPrice' });
    const many = ['recipe,ingredient,quantity,unit', ...Array.from({ length: 81 }, () => 'Big,Flour,1,גרם')].join('\n');
    expect((await caller().recipes.importCsv({ csv: many, dryRun: true })).errors[0]).toMatchObject({ code: 'tooManyLines' });
    // sauceA uses baseB, defined on a LATER row.
    const nested = ['recipe,ingredient,quantity,unit,sub_recipe,yield_unit', 'sauceA,baseB,100,גרם,yes,ק״ג', 'baseB,Flour,1,ק״ג,yes,ק״ג'].join('\n');
    expect(await caller().recipes.importCsv({ csv: nested, dryRun: true })).toMatchObject({ ok: true });
    expect(await caller().recipes.importCsv({ csv: nested, dryRun: false })).toMatchObject({ ok: true });
    const cyc = ['recipe,ingredient,quantity,unit,sub_recipe,yield_unit', 'c1,c2,1,ק״ג,yes,ק״ג', 'c2,c1,1,ק״ג,yes,ק״ג'].join('\n');
    expect((await caller().recipes.importCsv({ csv: cyc, dryRun: true })).errors.map((e) => e.code)).toContain('subRecipeCycle');
    // Re-import of a sub-recipe used by a dish, without a sub_recipe column, keeps it a sub-recipe.
    await caller().recipes.importCsv({ csv: 'recipe,ingredient,quantity,unit\nusesB,baseB,50,גרם', dryRun: false });
    const reimport = 'recipe,ingredient,quantity,unit,yield_unit\nbaseB,Flour,2,ק״ג,ק״ג';
    expect(await caller().recipes.importCsv({ csv: reimport, dryRun: false })).toMatchObject({ ok: true });
    expect((await caller().recipes.list()).recipes.find((r) => r.name === 'baseB')!.isSubRecipe).toBe(true);
    // Explicitly turning it into a dish is reported in the dry run, not a commit-time 409.
    const toDish = 'recipe,ingredient,quantity,unit,sub_recipe\nbaseB,Flour,2,ק״ג,no';
    expect((await caller().recipes.importCsv({ csv: toDish, dryRun: true })).errors[0]).toMatchObject({ code: 'subRecipeInUse' });
  });

  it('D3: a CSV replace keeps the menu price, names, notes and flags it does not state', async () => {
    const { id } = await caller().recipes.save({
      name: 'plate', nameEn: 'Plate', category: 'mains', notes: 'keep me', menuPriceAgorot: 5000, menuPriceIncludesVat: false,
      items: [{ productId: flour, quantity: '1', unit: 'ק״ג', wastePct: 0 }],
    });
    expect(await caller().recipes.importCsv({ csv: 'recipe,ingredient,quantity,unit\nplate,Flour,200,גרם', dryRun: false })).toMatchObject({ ok: true });
    const d = await caller().recipes.get({ id });
    expect(d.recipe).toMatchObject({ menuPriceAgorot: 5000, nameEn: 'Plate', category: 'mains', menuPriceIncludesVat: false });
    expect(d.notes).toBe('keep me');
    expect(d.items).toHaveLength(1);
  });

  it('D4: mangled numbers are rejected, not reinterpreted', async () => {
    const res = await caller().recipes.importCsv({
      csv: ['recipe,ingredient,quantity,unit,waste_pct,menu_price', 'n1,Flour,1,ק״ג,0x10,', 'n2,Flour,1,ק״ג,1e1,', 'n3,Flour,1,ק״ג,,"68,50"'].join('\n'),
      dryRun: true,
    });
    expect(res.errors.map((e) => e.code).sort()).toEqual(['badPrice', 'badWaste', 'badWaste']);
    const ok = await caller().recipes.importCsv({ csv: 'recipe,ingredient,quantity,unit,menu_price\nn4,Flour,1,ק״ג,"1,250.50"', dryRun: true });
    expect(ok.ok).toBe(true);
  });

  it('names are unique case-insensitively; waste keeps ≤ 2 decimals exactly', async () => {
    await caller().recipes.save({ name: 'Pasta', items: [] });
    await expect(caller().recipes.save({ name: 'pasta', items: [] })).rejects.toMatchObject({ message: 'recipes.duplicateName' });
    await expect(
      caller().recipes.save({ name: 'w', items: [{ productId: flour, quantity: '1', unit: 'ק״ג', wastePct: 2.675 }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('recipes: concurrent cycle saves (S4 cross-QA R1)', () => {
  it('two simultaneous saves closing X→Y / Y→X: one wins, the other gets recipes.cycle (no deadlock 500)', async () => {
    // Each caller runs in its own member transaction on the pooled connection.
    const mk = (name: string) =>
      caller().recipes.save({ name, isSubRecipe: true, yieldUnit: 'ק״ג', items: [{ productId: flour, quantity: '1', unit: 'ק״ג', wastePct: 0 }] });
    for (let round = 0; round < 5; round++) {
      const x = (await mk(`cx${round}`)).id;
      const y = (await mk(`cy${round}`)).id;
      const line = (sub: string) => ({ subRecipeId: sub, quantity: '100', unit: 'גרם', wastePct: 0 });
      const results = await Promise.allSettled([
        caller().recipes.save({ id: x, name: `cx${round}`, isSubRecipe: true, yieldUnit: 'ק״ג', items: [line(y)] }),
        caller().recipes.save({ id: y, name: `cy${round}`, isSubRecipe: true, yieldUnit: 'ק״ג', items: [line(x)] }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'BAD_REQUEST', message: 'recipes.cycle' });
    }
    // The data stays acyclic: every recipe still costs (no `cycle` line anywhere).
    const list = await caller().recipes.list();
    for (const r of list.recipes.filter((r) => r.name.startsWith('cx') || r.name.startsWith('cy'))) {
      const d = await caller().recipes.get({ id: r.id });
      expect(d.items.every((i) => i.status !== 'cycle')).toBe(true);
    }
  });
});
