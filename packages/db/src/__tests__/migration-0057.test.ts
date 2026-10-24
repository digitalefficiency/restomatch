import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, products, recipeItems, recipes, restaurants } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0056_recipes_prereqs + 0057_recipes (food cost per
 * dish): the tables exist with RLS + the tenant policy, the same-tenant
 * composite FKs reject cross-restaurant references, and the CHECKs hold
 * (exactly one source per line, positive qty, waste in [0, 100)).
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let rA: string;
let rB: string;
let productA: string;
let productB: string;

beforeAll(async () => {
  const [a] = await db.insert(restaurants).values({ name: '0057 A', businessId: '000000571' }).returning();
  const [b] = await db.insert(restaurants).values({ name: '0057 B', businessId: '000000572' }).returning();
  rA = a!.id;
  rB = b!.id;
  const [pa] = await db.insert(products).values({ restaurantId: rA, canonicalName: 'חזה עוף', defaultUnit: 'ק״ג' }).returning();
  const [pb] = await db.insert(products).values({ restaurantId: rB, canonicalName: 'חזה עוף', defaultUnit: 'ק״ג' }).returning();
  productA = pa!.id;
  productB = pb!.id;
});

afterAll(async () => {
  await db.delete(recipeItems).where(inArray(recipeItems.restaurantId, [rA, rB]));
  await db.delete(recipes).where(inArray(recipes.restaurantId, [rA, rB]));
  await db.delete(products).where(inArray(products.restaurantId, [rA, rB]));
  await db.delete(restaurants).where(inArray(restaurants.id, [rA, rB]));
  await sql.end();
});

describe('0056/0057 migration shape', () => {
  it('creates both tables with RLS enabled and the tenant policy', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('recipes', 'recipe_items')
      order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(rows).toEqual([
      { relname: 'recipe_items', relrowsecurity: true },
      { relname: 'recipes', relrowsecurity: true },
    ]);
    const policies = (await sql`
      select tablename, policyname, qual from pg_policies
      where schemaname = 'public' and tablename in ('recipes', 'recipe_items')
      order by tablename
    `) as unknown as Array<{ tablename: string; policyname: string; qual: string }>;
    expect(policies.map((p) => p.policyname)).toEqual(['recipe_items_tenant', 'recipes_tenant']);
    for (const p of policies) expect(p.qual).toContain('app.current_restaurant_id()');
  });

  it('exposes products (id, restaurant_id) as a unique FK target and indexes latest-price lookups', async () => {
    const [c] = (await sql`select 1 as ok from pg_constraint where conname = 'products_id_restaurant_id_key'`) as unknown as Array<{ ok: number }>;
    expect(c?.ok).toBe(1);
    const [i] = (await sql`select 1 as ok from pg_indexes where indexname = 'price_history_restaurant_product_observed_idx'`) as unknown as Array<{ ok: number }>;
    expect(i?.ok).toBe(1);
  });

  it('stores a dish with integer-agorot menu price and VAT flag defaults', async () => {
    const [r] = await db.insert(recipes).values({ restaurantId: rA, name: 'שניצל', menuPriceAgorot: 6800 }).returning();
    expect(r!.menuPriceAgorot).toBe(6800);
    expect(r!.menuPriceIncludesVat).toBe(true);
    expect(r!.yieldQty).toBe('1.0000');
    expect(r!.yieldUnit).toBe('מנה');
    expect(r!.isSubRecipe).toBe(false);
    const [line] = await db
      .insert(recipeItems)
      .values({ restaurantId: rA, recipeId: r!.id, productId: productA, quantity: '0.18', unit: 'ק״ג', wastePct: '5' })
      .returning();
    expect(line!.wastePct).toBe('5.00');
    await expect(
      db.insert(recipes).values({ restaurantId: rA, name: 'שניצל' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a line that points at another restaurant’s product or recipe (same-tenant FK)', async () => {
    const [mine] = await db.insert(recipes).values({ restaurantId: rA, name: 'xt-dish' }).returning();
    const [theirs] = await db.insert(recipes).values({ restaurantId: rB, name: 'xt-sauce', isSubRecipe: true }).returning();
    await expect(
      db.insert(recipeItems).values({ restaurantId: rA, recipeId: mine!.id, productId: productB, quantity: '1', unit: 'ק״ג' }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(recipeItems).values({ restaurantId: rA, recipeId: mine!.id, subRecipeId: theirs!.id, quantity: '1', unit: 'ק״ג' }),
    ).rejects.toMatchObject({ code: '23503' });
    // A line's restaurant must be its recipe's restaurant.
    await expect(
      db.insert(recipeItems).values({ restaurantId: rB, recipeId: mine!.id, productId: productB, quantity: '1', unit: 'ק״ג' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('enforces exactly one source, no self-reference, qty > 0 and waste in [0,100)', async () => {
    const [d] = await db.insert(recipes).values({ restaurantId: rA, name: 'checks' }).returning();
    const base = { restaurantId: rA, recipeId: d!.id, quantity: '1', unit: 'ק״ג' };
    await expect(db.insert(recipeItems).values({ ...base })).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(recipeItems).values({ ...base, productId: productA, subRecipeId: d!.id }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(db.insert(recipeItems).values({ ...base, subRecipeId: d!.id })).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(recipeItems).values({ ...base, productId: productA, quantity: '0' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(recipeItems).values({ ...base, productId: productA, wastePct: '100' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(recipes).values({ restaurantId: rA, name: 'neg', menuPriceAgorot: -1 }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('blocks deleting a product still used by a recipe; deleting the recipe removes its lines', async () => {
    const [p] = await db.insert(products).values({ restaurantId: rA, canonicalName: 'בצל', defaultUnit: 'ק״ג' }).returning();
    const [d] = await db.insert(recipes).values({ restaurantId: rA, name: 'onion soup' }).returning();
    await db.insert(recipeItems).values({ restaurantId: rA, recipeId: d!.id, productId: p!.id, quantity: '0.2', unit: 'ק״ג' });
    await expect(db.delete(products).where(eq(products.id, p!.id))).rejects.toMatchObject({ code: '23503' });
    await db.delete(recipes).where(eq(recipes.id, d!.id));
    expect(await db.select().from(recipeItems).where(eq(recipeItems.recipeId, d!.id))).toEqual([]);
    await db.delete(products).where(eq(products.id, p!.id));
  });
});
