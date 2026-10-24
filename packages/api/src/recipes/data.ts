import { TRPCError } from '@trpc/server';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  invoiceLines,
  lt,
  priceHistory,
  products,
  suppliers,
  recipeItems,
  recipes,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled } from '../lib/features';
import { DEFAULT_TARGET_BP, vatRateToBp, type CostRecipe, type ProductPrice } from './cost';

/**
 * Tenant-scoped reads for the recipe cost engine. Every query filters on the
 * caller's restaurant_id (and runs inside the member RLS transaction), so a
 * foreign id simply resolves to nothing.
 */

interface RecipeSettings {
  recipes?: { targetFoodCostBp?: number };
}

export interface RestaurantCostContext {
  vatBp: bigint;
  targetBp: number;
  timezone: string;
  settings: unknown;
}

export async function loadRestaurant(db: Database, restaurantId: string): Promise<RestaurantCostContext> {
  const [r] = await db
    .select({ vatRate: restaurants.vatRate, settings: restaurants.settings, timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'restaurant not found' });
  const target = (r.settings as RecipeSettings | null)?.recipes?.targetFoodCostBp;
  return {
    vatBp: vatRateToBp(r.vatRate),
    targetBp: Number.isInteger(target) && target! > 0 && target! < 10_000 ? target! : DEFAULT_TARGET_BP,
    timezone: r.timezone,
    settings: r.settings,
  };
}

/** FORBIDDEN (appCode FEATURE_DISABLED) unless `recipes` is on for this restaurant. */
export async function assertRecipesEnabled(db: Database, restaurantId: string): Promise<RestaurantCostContext> {
  const ctx = await loadRestaurant(db, restaurantId);
  if (!featureEnabled(ctx.settings, 'recipes')) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'FEATURE_DISABLED:recipes', { feature: 'recipes' });
  }
  return ctx;
}

export interface RecipeRow {
  id: string;
  name: string;
  nameEn: string | null;
  category: string | null;
  isSubRecipe: boolean;
  yieldQty: string;
  yieldUnit: string;
  menuPriceAgorot: number | null;
  menuPriceIncludesVat: boolean;
  active: boolean;
  notes: string | null;
  updatedAt: Date;
}

export interface ItemRow {
  id: string;
  recipeId: string;
  productId: string | null;
  subRecipeId: string | null;
  quantity: string;
  unit: string;
  wastePct: string;
  unitsPerProductUnit: string | null;
  sortOrder: number;
  note: string | null;
}

export async function loadRecipes(db: Database, restaurantId: string): Promise<{ rows: RecipeRow[]; items: ItemRow[] }> {
  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      nameEn: recipes.nameEn,
      category: recipes.category,
      isSubRecipe: recipes.isSubRecipe,
      yieldQty: recipes.yieldQty,
      yieldUnit: recipes.yieldUnit,
      menuPriceAgorot: recipes.menuPriceAgorot,
      menuPriceIncludesVat: recipes.menuPriceIncludesVat,
      active: recipes.active,
      notes: recipes.notes,
      updatedAt: recipes.updatedAt,
    })
    .from(recipes)
    .where(eq(recipes.restaurantId, restaurantId))
    .orderBy(asc(recipes.name));
  const items = await db
    .select({
      id: recipeItems.id,
      recipeId: recipeItems.recipeId,
      productId: recipeItems.productId,
      subRecipeId: recipeItems.subRecipeId,
      quantity: recipeItems.quantity,
      unit: recipeItems.unit,
      wastePct: recipeItems.wastePct,
      unitsPerProductUnit: recipeItems.unitsPerProductUnit,
      sortOrder: recipeItems.sortOrder,
      note: recipeItems.note,
    })
    .from(recipeItems)
    .where(eq(recipeItems.restaurantId, restaurantId))
    .orderBy(asc(recipeItems.sortOrder), asc(recipeItems.createdAt));
  return { rows, items };
}

export function toCostRecipes(rows: RecipeRow[], items: ItemRow[]): CostRecipe[] {
  const byRecipe = new Map<string, ItemRow[]>();
  for (const it of items) byRecipe.set(it.recipeId, [...(byRecipe.get(it.recipeId) ?? []), it]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isSubRecipe: r.isSubRecipe,
    yieldQty: r.yieldQty,
    yieldUnit: r.yieldUnit,
    menuPriceAgorot: r.menuPriceAgorot,
    menuPriceIncludesVat: r.menuPriceIncludesVat,
    items: (byRecipe.get(r.id) ?? []).map((it) => ({
      id: it.id,
      productId: it.productId,
      subRecipeId: it.subRecipeId,
      quantity: it.quantity,
      unit: it.unit,
      wastePct: it.wastePct,
      unitsPerProductUnit: it.unitsPerProductUnit,
    })),
  }));
}

export interface PriceWithDate extends ProductPrice {
  observedAt: Date;
  /** Supplier the price was paid to (the latest observation's supplier). */
  supplierId: string;
}

/**
 * The unit a price_history row is per. writePriceHistoryForInvoice normalizes
 * to products.default_unit when the product has one; when it has none
 * (e.g. products created on the OCR mapping "new product" path) the billed
 * price is stored unchanged — per the unit of the invoice line it came from.
 * Costing that price as "per the recipe line's unit" was 1000× off for a
 * recipe in grams against a per-kg invoice, so the billed unit is recovered
 * from the source line; with neither, the unit stays null (unknown) and the
 * cost engine refuses to guess (`unitMismatch` unless a manual bridge is set).
 */
const priceUnitSql = sql<string | null>`coalesce(${products.defaultUnit}, (
  select il.unit from ${invoiceLines} il
  where il.invoice_id = ${priceHistory.sourceInvoiceId}
    and il.product_id = ${priceHistory.productId}
  order by (il.unit_price_billed = ${priceHistory.unitPrice}) desc, il.id
  limit 1
))`;

/**
 * The latest ACTUALLY PAID unit price per product (price_history, ex-VAT, per
 * `unit` — see priceUnitSql), optionally as of an instant (`before`, exclusive).
 *
 * Contract prices (the `contracts` feature, S11) would be preferred here once
 * they exist; this function is the single seam to add that source — nothing in
 * the cost engine depends on where a price came from.
 */
export async function latestPrices(
  db: Database,
  restaurantId: string,
  opts: { before?: Date; productIds?: string[] } = {},
): Promise<Map<string, PriceWithDate>> {
  const conds = [eq(priceHistory.restaurantId, restaurantId)];
  if (opts.before) conds.push(lt(priceHistory.observedAt, opts.before));
  if (opts.productIds) {
    if (opts.productIds.length === 0) return new Map();
    conds.push(inArray(priceHistory.productId, opts.productIds));
  }
  const rows = await db
    .selectDistinctOn([priceHistory.productId], {
      productId: priceHistory.productId,
      unitPrice: priceHistory.unitPrice,
      observedAt: priceHistory.observedAt,
      supplierId: priceHistory.supplierId,
      unit: priceUnitSql,
    })
    .from(priceHistory)
    .innerJoin(products, and(eq(products.id, priceHistory.productId), eq(products.restaurantId, restaurantId)))
    .where(and(...conds))
    .orderBy(priceHistory.productId, desc(priceHistory.observedAt), desc(priceHistory.id));
  return new Map(rows.map((r) => [r.productId, { unitPrice: r.unitPrice, unit: r.unit, observedAt: r.observedAt, supplierId: r.supplierId }]));
}

/** The first price per product observed at or after `from` (baseline for products first bought this period). */
export async function earliestPricesFrom(
  db: Database,
  restaurantId: string,
  from: Date,
  productIds?: string[],
): Promise<Map<string, PriceWithDate>> {
  if (productIds && productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([priceHistory.productId], {
      productId: priceHistory.productId,
      unitPrice: priceHistory.unitPrice,
      observedAt: priceHistory.observedAt,
      supplierId: priceHistory.supplierId,
      unit: priceUnitSql,
    })
    .from(priceHistory)
    .innerJoin(products, and(eq(products.id, priceHistory.productId), eq(products.restaurantId, restaurantId)))
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        gte(priceHistory.observedAt, from),
        ...(productIds ? [inArray(priceHistory.productId, productIds)] : []),
      ),
    )
    .orderBy(priceHistory.productId, asc(priceHistory.observedAt), asc(priceHistory.id));
  return new Map(rows.map((r) => [r.productId, { unitPrice: r.unitPrice, unit: r.unit, observedAt: r.observedAt, supplierId: r.supplierId }]));
}

export interface ProductInfo {
  id: string;
  name: string;
  nameEn: string | null;
  unit: string | null;
  category: string | null;
}

export async function loadProducts(db: Database, restaurantId: string, ids: string[]): Promise<Map<string, ProductInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: products.id,
      name: products.canonicalName,
      nameEn: products.nameEn,
      unit: products.defaultUnit,
      category: products.category,
    })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, ids)));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * POS sales per item for [from, to] (dates, inclusive) — the same aggregate as
 * S5's `integrations.posSummary` (`pos_sales`, migration 0058). Returns null
 * when the POS table does not exist on this database yet (the integrations
 * wave not deployed), so food cost shows a neutral "no POS data" state instead
 * of failing. Runs in the member transaction: RLS scopes `pos_sales` too.
 */
export async function loadPosSales(
  db: Database,
  restaurantId: string,
  from: string,
  to: string,
): Promise<Array<{ itemRef: string; itemName: string; qty: string; netAmount: string }> | null> {
  const [reg] = (await db.execute(sql`select to_regclass('public.pos_sales')::text as t`)) as unknown as Array<{ t: string | null }>;
  if (!reg?.t) return null;
  // The member transaction must survive a missing grant (0058 applied before the
  // app role's grants were refreshed): probe privilege first, never throw.
  const [can] = (await db.execute(
    sql`select has_table_privilege(current_user, 'public.pos_sales', 'SELECT') as ok`,
  )) as unknown as Array<{ ok: boolean }>;
  if (!can?.ok) return null;
  const rows = (await db.execute(sql`
    select item_ref as "itemRef", max(item_name) as "itemName",
           sum(qty)::numeric(14,3)::text as qty, sum(net_amount)::numeric(14,2)::text as "netAmount"
    from pos_sales
    where restaurant_id = ${restaurantId} and sold_on >= ${from}::date and sold_on <= ${to}::date
    group by item_ref
  `)) as unknown as Array<{ itemRef: string; itemName: string; qty: string; netAmount: string }>;
  return [...rows];
}

export async function loadSuppliers(
  db: Database,
  restaurantId: string,
  ids: string[],
): Promise<Map<string, { name: string; nameEn: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), inArray(suppliers.id, ids)));
  return new Map(rows.map((r) => [r.id, { name: r.name, nameEn: r.nameEn }]));
}
