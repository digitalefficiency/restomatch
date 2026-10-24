import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  eq,
  inArray,
  ne,
  products,
  recipeItems,
  recipes,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { startOfDayInTz } from '../lib/time';
import { chefProcedure, managerProcedure, memberProcedure, router } from '../trpc';
import {
  assertNoCycle,
  costLight,
  costRecipes,
  diffCosts,
  RecipeCycleError,
  simulatePriceChange,
  unitsCompatible,
  type CostRecipe,
  type RecipeCost,
} from '../recipes/cost';
import {
  assertRecipesEnabled,
  earliestPricesFrom,
  latestPrices,
  loadPosSales,
  loadProducts,
  loadRecipes,
  loadRestaurant,
  toCostRecipes,
  type ItemRow,
  type PriceWithDate,
  type RecipeRow,
} from '../recipes/data';
import { parseRecipeCsv, type CsvRecipe } from '../recipes/csv';
import { posVsTheory } from '../recipes/pos';

/**
 * Food cost per dish (wave 1, flag `recipes`). Owner / manager / chef read and
 * edit recipes (chefProcedure); the restaurant-wide food-cost target is a
 * manager+ setting. Every procedure except `enabled` is FORBIDDEN with appCode
 * FEATURE_DISABLED unless the restaurant has the flag on.
 *
 * Errors the UI translates carry a stable English token as the message
 * (`recipes.<code>`), never Hebrew text.
 */

const DECIMAL4 = /^\d{1,8}(\.\d{1,4})?$/;
const qtyString = z
  .string()
  .trim()
  .regex(DECIMAL4)
  .refine((v) => Number(v) > 0, 'must be positive');
const unitString = z.string().trim().min(1).max(32);

const itemInput = z
  .object({
    productId: z.string().uuid().nullable().optional(),
    subRecipeId: z.string().uuid().nullable().optional(),
    quantity: qtyString,
    unit: unitString,
    // ≤ 2 decimals so the stored NUMERIC(5,2) is exactly what was sent (no silent rounding).
    wastePct: z
      .number()
      .min(0)
      .max(95)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'max 2 decimals')
      .default(0),
    unitsPerProductUnit: qtyString.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => !!v.productId !== !!v.subRecipeId, { message: 'exactly one of productId / subRecipeId' });

const recipeInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  isSubRecipe: z.boolean().default(false),
  yieldQty: qtyString.default('1'),
  yieldUnit: unitString.default('מנה'),
  menuPriceAgorot: z.number().int().min(0).max(10_000_000).nullable().optional(),
  menuPriceIncludesVat: z.boolean().default(true),
  active: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(itemInput).max(80),
});

function fail(code: TRPCError['code'], token: string): never {
  throw new TRPCError({ code, message: `recipes.${token}` });
}

/** Feature-gated chef+ procedure; resolvers get the restaurant cost context. */
const recipesProcedure = chefProcedure.use(async ({ ctx, next }) => {
  const rc = await assertRecipesEnabled(ctx.db, ctx.session.restaurantId);
  return next({ ctx: { ...ctx, rc } });
});
const recipesManagerProcedure = managerProcedure.use(async ({ ctx, next }) => {
  const rc = await assertRecipesEnabled(ctx.db, ctx.session.restaurantId);
  return next({ ctx: { ...ctx, rc } });
});

interface Loaded {
  rows: RecipeRow[];
  items: ItemRow[];
  costInput: CostRecipe[];
  prices: Map<string, PriceWithDate>;
  costs: Map<string, RecipeCost>;
}

async function loadAll(db: Database, restaurantId: string, vatBp: bigint): Promise<Loaded> {
  const { rows, items } = await loadRecipes(db, restaurantId);
  const costInput = toCostRecipes(rows, items);
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const prices = await latestPrices(db, restaurantId, { productIds });
  const costs = costRecipes(costInput, prices, vatBp);
  return { rows, items, costInput, prices, costs };
}

function summary(r: RecipeRow, c: RecipeCost | undefined, targetBp: number) {
  return {
    id: r.id,
    name: r.name,
    nameEn: r.nameEn,
    category: r.category,
    isSubRecipe: r.isSubRecipe,
    active: r.active,
    yieldQty: r.yieldQty,
    yieldUnit: r.yieldUnit,
    menuPriceAgorot: r.menuPriceAgorot,
    menuPriceIncludesVat: r.menuPriceIncludesVat,
    portionCostAgorot: c?.portionCostAgorot ?? 0,
    batchCostAgorot: c?.batchCostAgorot ?? 0,
    netMenuPriceAgorot: c?.netMenuPriceAgorot ?? null,
    foodCostBp: c?.foodCostBp ?? null,
    grossMarginAgorot: c?.grossMarginAgorot ?? null,
    complete: c?.complete ?? true,
    light: r.isSubRecipe ? ('none' as const) : costLight(c?.foodCostBp ?? null, targetBp),
    lineCount: c?.lines.length ?? 0,
  };
}

/** Start of the current calendar month on the restaurant's wall clock. */
export function startOfMonthInTz(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  // Noon UTC on the 1st is the 1st in every zone within ±12h; take its local midnight.
  return startOfDayInTz(new Date(Date.UTC(y, m - 1, 1, 12)), tz);
}

/** Validate a save's lines: products + sub-recipes belong to the restaurant, units are costable, no cycle. */
async function validateItems(
  db: Database,
  restaurantId: string,
  recipeId: string | undefined,
  items: z.infer<typeof itemInput>[],
): Promise<void> {
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const subIds = [...new Set(items.map((i) => i.subRecipeId).filter((x): x is string => !!x))];
  if (productIds.length) {
    const owned = await loadProducts(db, restaurantId, productIds);
    if (owned.size !== productIds.length) fail('NOT_FOUND', 'productNotFound');
    // No default unit → the unit the latest paid price is per (the billed unit).
    // Still unknown → nothing to check against yet (costed as missingPrice /
    // unitMismatch, never as if the price were per the line's unit).
    const priced = await latestPrices(db, restaurantId, { productIds });
    for (const it of items) {
      if (!it.productId) continue;
      const unit = owned.get(it.productId)!.unit ?? priced.get(it.productId)?.unit ?? null;
      if (unit && !unitsCompatible(it.unit, unit) && !it.unitsPerProductUnit) fail('BAD_REQUEST', 'unitMismatch');
    }
  }
  if (subIds.length) {
    if (recipeId && subIds.includes(recipeId)) fail('BAD_REQUEST', 'cycle');
    const subs = await db
      .select({ id: recipes.id, yieldUnit: recipes.yieldUnit, isSubRecipe: recipes.isSubRecipe })
      .from(recipes)
      .where(and(eq(recipes.restaurantId, restaurantId), inArray(recipes.id, subIds)));
    if (subs.length !== subIds.length) fail('NOT_FOUND', 'subRecipeNotFound');
    if (subs.some((s) => !s.isSubRecipe)) fail('BAD_REQUEST', 'notSubRecipe');
    const subUnit = new Map(subs.map((s) => [s.id, s.yieldUnit]));
    for (const it of items) {
      if (!it.subRecipeId) continue;
      if (!unitsCompatible(it.unit, subUnit.get(it.subRecipeId)!) && !it.unitsPerProductUnit) fail('BAD_REQUEST', 'unitMismatch');
    }
    if (recipeId) {
      const edgesRows = await db
        .select({ recipeId: recipeItems.recipeId, subRecipeId: recipeItems.subRecipeId })
        .from(recipeItems)
        .where(and(eq(recipeItems.restaurantId, restaurantId), sql`${recipeItems.subRecipeId} is not null`));
      const edges = new Map<string, string[]>();
      for (const e of edgesRows) edges.set(e.recipeId, [...(edges.get(e.recipeId) ?? []), e.subRecipeId!]);
      try {
        assertNoCycle(recipeId, subIds, edges);
      } catch (err) {
        if (err instanceof RecipeCycleError) fail('BAD_REQUEST', 'cycle');
        throw err;
      }
    }
  }
}

/**
 * Serialise recipe writes per restaurant for the rest of the member transaction
 * (S4 cross-QA R1). Two concurrent saves that would together close a sub-recipe
 * cycle (X→Y while Y→X) otherwise both pass the cycle check on uncommitted edges
 * and one dies in a Postgres deadlock (generic 500). Holding this transaction-scoped
 * advisory lock first, the second save waits, then sees the committed edge and gets
 * the friendly `recipes.cycle`. Released automatically at commit/rollback.
 */
async function lockRecipeWrites(db: Database, restaurantId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`recipes:${restaurantId}`}))`);
}

async function writeRecipe(
  db: Database,
  restaurantId: string,
  input: z.infer<typeof recipeInput>,
): Promise<string> {
  const dup = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.restaurantId, restaurantId),
        sql`lower(${recipes.name}) = lower(${input.name})`,
        ...(input.id ? [ne(recipes.id, input.id)] : []),
      ),
    )
    .limit(1);
  if (dup.length) fail('CONFLICT', 'duplicateName');

  await validateItems(db, restaurantId, input.id, input.items);
  // A sub-recipe other recipes use cannot be turned into a (sellable) dish.
  if (!input.isSubRecipe && input.id) {
    const [used] = await db
      .select({ id: recipeItems.id })
      .from(recipeItems)
      .where(and(eq(recipeItems.restaurantId, restaurantId), eq(recipeItems.subRecipeId, input.id)))
      .limit(1);
    if (used) fail('CONFLICT', 'inUse');
  }

  const values = {
    name: input.name,
    nameEn: input.nameEn || null,
    category: input.category || null,
    isSubRecipe: input.isSubRecipe,
    yieldQty: input.yieldQty,
    yieldUnit: input.yieldUnit,
    menuPriceAgorot: input.isSubRecipe ? null : (input.menuPriceAgorot ?? null),
    menuPriceIncludesVat: input.menuPriceIncludesVat,
    active: input.active,
    notes: input.notes || null,
  };
  let id = input.id;
  if (id) {
    const [row] = await db
      .update(recipes)
      .set(values)
      .where(and(eq(recipes.id, id), eq(recipes.restaurantId, restaurantId)))
      .returning({ id: recipes.id });
    if (!row) fail('NOT_FOUND', 'notFound');
    await db.delete(recipeItems).where(and(eq(recipeItems.recipeId, id), eq(recipeItems.restaurantId, restaurantId)));
  } else {
    const [row] = await db.insert(recipes).values({ restaurantId, ...values }).returning({ id: recipes.id });
    id = row!.id;
  }
  if (input.items.length) {
    await db.insert(recipeItems).values(
      input.items.map((it, i) => ({
        restaurantId,
        recipeId: id!,
        productId: it.productId ?? null,
        subRecipeId: it.subRecipeId ?? null,
        quantity: it.quantity,
        unit: it.unit,
        wastePct: (Math.round(it.wastePct * 100) / 100).toFixed(2),
        unitsPerProductUnit: it.unitsPerProductUnit ?? null,
        sortOrder: i,
        note: it.note || null,
      })),
    );
  }
  // Reject a save that makes any recipe's cost absurd (overflow), instead of
  // storing a row that would show every screen an `overflow` dish.
  const all = await loadAll(db, restaurantId, 0n);
  if ([...all.costs.values()].some((c) => c.lines.some((l) => l.status === 'overflow'))) fail('BAD_REQUEST', 'tooLarge');
  return id!;
}

export const recipesRouter = router({
  /** Whether the `recipes` feature is on for the caller's restaurant (drives the nav). Never FORBIDDEN. */
  enabled: memberProcedure.query(async ({ ctx }) => {
    const rc = await loadRestaurant(ctx.db, ctx.session.restaurantId);
    return { enabled: featureEnabled(rc.settings, 'recipes') };
  }),

  /** Every recipe with its current cost, food-cost %, margin and traffic light. */
  list: recipesProcedure.query(async ({ ctx }) => {
    const all = await loadAll(ctx.db, ctx.session.restaurantId, ctx.rc.vatBp);
    return {
      targetBp: ctx.rc.targetBp,
      recipes: all.rows.map((r) => summary(r, all.costs.get(r.id), ctx.rc.targetBp)),
    };
  }),

  /** One recipe with its costed lines (product / sub-recipe names, price used, unit). */
  get: recipesProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    const all = await loadAll(ctx.db, rid, ctx.rc.vatBp);
    const r = all.rows.find((x) => x.id === input.id);
    if (!r) fail('NOT_FOUND', 'notFound');
    const cost = all.costs.get(r.id)!;
    const items = all.items.filter((i) => i.recipeId === r.id);
    const productInfo = await loadProducts(ctx.db, rid, items.map((i) => i.productId).filter((x): x is string => !!x));
    const names = new Map(all.rows.map((x) => [x.id, x] as const));
    return {
      targetBp: ctx.rc.targetBp,
      recipe: summary(r, cost, ctx.rc.targetBp),
      notes: r.notes,
      items: items.map((it) => {
        const line = cost.lines.find((l) => l.itemId === it.id);
        const p = it.productId ? productInfo.get(it.productId) : undefined;
        const sub = it.subRecipeId ? names.get(it.subRecipeId) : undefined;
        const price = it.productId ? all.prices.get(it.productId) : undefined;
        return {
          id: it.id,
          productId: it.productId,
          subRecipeId: it.subRecipeId,
          name: p?.name ?? sub?.name ?? '',
          nameEn: p?.nameEn ?? sub?.nameEn ?? null,
          sourceUnit: (p ? (p.unit ?? price?.unit) : sub?.yieldUnit) ?? null,
          quantity: it.quantity,
          unit: it.unit,
          wastePct: it.wastePct,
          unitsPerProductUnit: it.unitsPerProductUnit,
          note: it.note,
          unitPrice: price?.unitPrice ?? null,
          priceObservedAt: price?.observedAt ?? null,
          costAgorot: line?.costAgorot ?? 0,
          status: line?.status ?? 'ok',
        };
      }),
    };
  }),

  /** Create (no id) or replace (id) a recipe and all its lines. */
  save: recipesProcedure.input(recipeInput).mutation(async ({ ctx, input }) => {
    await lockRecipeWrites(ctx.db, ctx.session.restaurantId);
    const id = await writeRecipe(ctx.db, ctx.session.restaurantId, input);
    return { id };
  }),

  delete: recipesProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    const [owned] = await ctx.db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, input.id), eq(recipes.restaurantId, rid)))
      .limit(1);
    if (!owned) fail('NOT_FOUND', 'notFound');
    const [used] = await ctx.db
      .select({ id: recipeItems.id })
      .from(recipeItems)
      .where(and(eq(recipeItems.restaurantId, rid), eq(recipeItems.subRecipeId, input.id)))
      .limit(1);
    if (used) fail('CONFLICT', 'inUse');
    await ctx.db.delete(recipes).where(and(eq(recipes.id, input.id), eq(recipes.restaurantId, rid)));
    return { ok: true };
  }),

  /** Product picker for the editor: name/English match, with the latest paid price + unit. */
  searchProducts: recipesProcedure
    .input(z.object({ search: z.string().trim().max(100).default(''), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const conds = [eq(products.restaurantId, rid)];
      if (input.search) {
        const like = `%${input.search}%`;
        conds.push(sql`(${products.canonicalName} ILIKE ${like} OR ${products.nameEn} ILIKE ${like})`);
      }
      const rows = await ctx.db
        .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, unit: products.defaultUnit, category: products.category })
        .from(products)
        .where(and(...conds))
        .orderBy(asc(products.canonicalName))
        .limit(input.limit);
      const prices = await latestPrices(ctx.db, rid, { productIds: rows.map((r) => r.id) });
      return rows.map((r) => ({
        ...r,
        unit: r.unit ?? prices.get(r.id)?.unit ?? null,
        unitPrice: prices.get(r.id)?.unitPrice ?? null,
        priceObservedAt: prices.get(r.id)?.observedAt ?? null,
      }));
    }),

  /** Sub-recipes available to use inside another recipe. */
  subRecipes: recipesProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: recipes.id, name: recipes.name, nameEn: recipes.nameEn, yieldQty: recipes.yieldQty, yieldUnit: recipes.yieldUnit })
      .from(recipes)
      .where(and(eq(recipes.restaurantId, ctx.session.restaurantId), eq(recipes.isSubRecipe, true)))
      .orderBy(asc(recipes.name));
  }),

  /**
   * "What if": the dishes affected when one product's price moves by
   * `changePct` (−90…+500), e.g. chicken +12% → schnitzel 31% → 34%, −₪2.10/plate.
   */
  impact: recipesProcedure
    .input(z.object({ productId: z.string().uuid(), changePct: z.number().min(-90).max(500) }))
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const [p] = await ctx.db
        .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, unit: products.defaultUnit })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.restaurantId, rid)))
        .limit(1);
      if (!p) fail('NOT_FOUND', 'productNotFound');
      const all = await loadAll(ctx.db, rid, ctx.rc.vatBp);
      const changeBp = Math.round(input.changePct * 100);
      const rows = simulatePriceChange(all.costInput, all.prices, ctx.rc.vatBp, input.productId, changeBp);
      const byId = new Map(all.rows.map((r) => [r.id, r] as const));
      return {
        product: { ...p, unit: p.unit ?? all.prices.get(p.id)?.unit ?? null, unitPrice: all.prices.get(p.id)?.unitPrice ?? null },
        changeBp,
        targetBp: ctx.rc.targetBp,
        rows: rows.map((row) => {
          const r = byId.get(row.recipeId)!;
          return {
            recipeId: r.id,
            name: r.name,
            nameEn: r.nameEn,
            isSubRecipe: r.isSubRecipe,
            beforeCostAgorot: row.before.portionCostAgorot,
            afterCostAgorot: row.after.portionCostAgorot,
            beforeFoodCostBp: row.before.foodCostBp,
            afterFoodCostBp: row.after.foodCostBp,
            marginDeltaAgorot: row.marginDeltaAgorot,
            costDeltaAgorot: row.portionCostDeltaAgorot,
            afterLight: r.isSubRecipe ? ('none' as const) : costLight(row.after.foodCostBp, ctx.rc.targetBp),
          };
        }),
      };
    }),

  /**
   * "What changed this month": each recipe costed at the prices in force at the
   * start of the restaurant's calendar month vs now, sorted by the biggest move,
   * with the ingredient that moved it most (the "why").
   */
  changes: recipesProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    const all = await loadAll(ctx.db, rid, ctx.rc.vatBp);
    const since = startOfMonthInTz(new Date(), ctx.rc.timezone);
    const productIds = [...all.prices.keys()];
    const before = await latestPrices(ctx.db, rid, { before: since, productIds });
    // A product first bought this month has no "before": its first price this month is the baseline.
    const firstThisMonth = await earliestPricesFrom(ctx.db, rid, since, productIds);
    for (const [pid, p] of firstThisMonth) if (!before.has(pid) && all.prices.has(pid)) before.set(pid, p);
    const beforeCosts = costRecipes(all.costInput, before, ctx.rc.vatBp);
    const diffs = diffCosts(all.costInput, beforeCosts, all.costs);
    const byId = new Map(all.rows.map((r) => [r.id, r] as const));
    const itemsById = new Map(all.items.map((i) => [i.id, i] as const));
    const productInfo = await loadProducts(ctx.db, rid, productIds);
    return {
      since,
      targetBp: ctx.rc.targetBp,
      /** Active dishes on the menu (0 ⇒ "no recipes yet", never "prices are steady"). */
      activeDishCount: all.rows.filter((r) => r.active && !r.isSubRecipe).length,
      rows: diffs.map((d) => {
        const r = byId.get(d.recipeId)!;
        // The "why": the line whose cost moved most.
        let driver: { itemId: string; deltaAgorot: number } | null = null;
        for (const l of d.after.lines) {
          const b = d.before.lines.find((x) => x.itemId === l.itemId);
          const delta = l.costAgorot - (b?.costAgorot ?? 0);
          if (!driver || Math.abs(delta) > Math.abs(driver.deltaAgorot)) driver = { itemId: l.itemId, deltaAgorot: delta };
        }
        const it = driver ? itemsById.get(driver.itemId) : undefined;
        const prod = it?.productId ? productInfo.get(it.productId) : undefined;
        const sub = it?.subRecipeId ? byId.get(it.subRecipeId) : undefined;
        const priceBefore = it?.productId ? before.get(it.productId)?.unitPrice ?? null : null;
        const priceNow = it?.productId ? all.prices.get(it.productId)?.unitPrice ?? null : null;
        return {
          recipeId: r.id,
          name: r.name,
          nameEn: r.nameEn,
          isSubRecipe: r.isSubRecipe,
          active: r.active,
          beforeCostAgorot: d.before.portionCostAgorot,
          afterCostAgorot: d.after.portionCostAgorot,
          beforeFoodCostBp: d.before.foodCostBp,
          afterFoodCostBp: d.after.foodCostBp,
          costDeltaAgorot: d.portionCostDeltaAgorot,
          marginDeltaAgorot: d.marginDeltaAgorot,
          afterLight: r.isSubRecipe ? ('none' as const) : costLight(d.after.foodCostBp, ctx.rc.targetBp),
          driver: driver && it
            ? {
                kind: it.productId ? ('product' as const) : ('subRecipe' as const),
                name: prod?.name ?? sub?.name ?? '',
                nameEn: prod?.nameEn ?? sub?.nameEn ?? null,
                unit: prod?.unit ?? (it.productId ? all.prices.get(it.productId)?.unit : null) ?? null,
                deltaAgorot: driver.deltaAgorot,
                priceBefore,
                priceNow,
              }
            : null,
        };
      }),
    };
  }),

  /**
   * Theoretical vs actual food cost per dish from POS sales (needs the
   * `integrations` flag too). `month`: the restaurant's current or previous
   * calendar month. Never FORBIDDEN for a missing integrations flag or POS
   * table — it answers `available: false` with the reason, so the recipes page
   * shows a neutral empty state.
   */
  posVsTheory: recipesProcedure
    .input(z.object({ month: z.enum(['current', 'previous']).default('current') }).optional())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const thisMonth = startOfMonthInTz(new Date(), ctx.rc.timezone);
      const start = input?.month === 'previous' ? startOfMonthInTz(new Date(thisMonth.getTime() - 86_400_000), ctx.rc.timezone) : thisMonth;
      const end = input?.month === 'previous' ? new Date(thisMonth.getTime() - 1) : new Date();
      const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ctx.rc.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const period = { from: ymd(start), to: ymd(end) };
      const empty = { ...period, rows: [], totals: { netSalesAgorot: 0, theoreticalCostAgorot: 0, foodCostBp: null }, unmatched: [], unmatchedCount: 0 };
      if (!featureEnabled(ctx.rc.settings, 'integrations')) return { available: false as const, reason: 'integrationsOff' as const, ...empty };
      const sales = await loadPosSales(ctx.db, rid, period.from, period.to);
      if (!sales || sales.length === 0) return { available: false as const, reason: 'noPosData' as const, ...empty };
      const all = await loadAll(ctx.db, rid, ctx.rc.vatBp);
      const res = posVsTheory(sales, all.rows, all.costs);
      const byId = new Map(all.rows.map((r) => [r.id, r] as const));
      return {
        available: true as const,
        reason: null,
        ...period,
        targetBp: ctx.rc.targetBp,
        rows: res.rows.map((r) => ({ ...r, name: byId.get(r.recipeId)!.name, nameEn: byId.get(r.recipeId)!.nameEn })),
        totals: res.totals,
        unmatched: res.unmatched.slice(0, 10),
        unmatchedCount: res.unmatched.length,
      };
    }),

  /** Restaurant-wide food-cost target (%), drives the red/amber/green light. Manager+. */
  setTarget: recipesManagerProcedure
    .input(z.object({ targetPct: z.number().min(5).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      const targetFoodCostBp = Math.round(input.targetPct * 100);
      // jsonb_set keeps every other settings key (features, tolerances…) intact.
      await ctx.db
        .update(restaurants)
        .set({
          settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), '{recipes}', (case when jsonb_typeof(${restaurants.settings}->'recipes') = 'object' then ${restaurants.settings}->'recipes' else '{}'::jsonb end) || ${JSON.stringify({ targetFoodCostBp })}::jsonb)`,
        })
        .where(eq(restaurants.id, rid));
      return { targetBp: targetFoodCostBp };
    }),

  /**
   * Optional CSV import (one row per ingredient line; see recipes/csv.ts for the
   * columns). Products / sub-recipes are matched by Hebrew or English name inside
   * the restaurant. `dryRun` validates and previews without writing. A recipe
   * with the same name is replaced.
   */
  importCsv: recipesProcedure
    .input(z.object({ csv: z.string().max(200_000), dryRun: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await lockRecipeWrites(ctx.db, rid);
      const parsed = parseRecipeCsv(input.csv);
      if (parsed.fatal) return { ok: false as const, errors: [parsed.fatal], recipes: [] as Array<{ name: string; lines: number; action: 'create' | 'replace' }> };
      const prodRows = await ctx.db
        .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, unit: products.defaultUnit })
        .from(products)
        .where(eq(products.restaurantId, rid));
      const existing = await ctx.db
        .select({
          id: recipes.id,
          name: recipes.name,
          nameEn: recipes.nameEn,
          category: recipes.category,
          isSubRecipe: recipes.isSubRecipe,
          menuPriceAgorot: recipes.menuPriceAgorot,
          menuPriceIncludesVat: recipes.menuPriceIncludesVat,
          active: recipes.active,
          notes: recipes.notes,
        })
        .from(recipes)
        .where(eq(recipes.restaurantId, rid));
      const usedAsSub = new Set(
        (
          await ctx.db
            .select({ id: recipeItems.subRecipeId })
            .from(recipeItems)
            .where(and(eq(recipeItems.restaurantId, rid), sql`${recipeItems.subRecipeId} is not null`))
        ).map((r) => r.id!),
      );
      const key = (s: string) => s.trim().toLowerCase();
      const prodByName = new Map<string, (typeof prodRows)[number]>();
      for (const p of prodRows) {
        prodByName.set(key(p.name), p);
        if (p.nameEn) prodByName.set(key(p.nameEn), p);
      }
      const existingByName = new Map(existing.map((r) => [key(r.name), r] as const));
      const errors = [...parsed.errors];
      // Effective sub-recipe flag: the CSV's, else the existing recipe's (a replace keeps it).
      const isSub = (r: CsvRecipe) => r.isSubRecipe ?? existingByName.get(key(r.name))?.isSubRecipe ?? false;
      const csvByName = new Map(parsed.recipes.map((r) => [key(r.name), r] as const));
      const firstRow = (r: CsvRecipe) => r.lines[0]?.row ?? 2;
      for (const r of parsed.recipes) {
        for (const l of r.lines) {
          const k = key(l.ingredient);
          if (prodByName.has(k)) continue;
          const csvSub = csvByName.get(k);
          if (csvSub ? isSub(csvSub) : existingByName.get(k)?.isSubRecipe) continue;
          errors.push({ row: l.row, code: 'unknownIngredient', value: l.ingredient });
        }
        const ex = existingByName.get(key(r.name));
        if (ex && usedAsSub.has(ex.id) && !isSub(r)) errors.push({ row: firstRow(r), code: 'subRecipeInUse', value: r.name });
      }
      // Sub-recipes in dependency order (a sauce that uses a base comes after the base).
      const subs = parsed.recipes.filter(isSub);
      const ordered: CsvRecipe[] = [];
      const state = new Map<string, 'visiting' | 'done'>();
      const visit = (r: CsvRecipe): boolean => {
        const k = key(r.name);
        if (state.get(k) === 'done') return true;
        if (state.get(k) === 'visiting') return false;
        state.set(k, 'visiting');
        for (const l of r.lines) {
          const dep = prodByName.has(key(l.ingredient)) ? undefined : csvByName.get(key(l.ingredient));
          if (dep && isSub(dep) && !visit(dep)) return false;
        }
        state.set(k, 'done');
        ordered.push(r);
        return true;
      };
      for (const r of subs) if (!visit(r)) errors.push({ row: firstRow(r), code: 'subRecipeCycle', value: r.name });
      ordered.push(...parsed.recipes.filter((r) => !isSub(r)));

      const preview = parsed.recipes.map((r) => ({
        name: r.name,
        lines: r.lines.length,
        action: existingByName.has(key(r.name)) ? ('replace' as const) : ('create' as const),
      }));
      if (errors.length || input.dryRun) return { ok: errors.length === 0, errors, recipes: preview };

      const idByName = new Map(existing.map((r) => [key(r.name), r.id] as const));
      for (const r of ordered) {
        const ex = existingByName.get(key(r.name));
        const items = r.lines.map((l) => {
          const p = prodByName.get(key(l.ingredient));
          const subId = !p ? idByName.get(key(l.ingredient)) : undefined;
          return {
            productId: p?.id ?? null,
            subRecipeId: subId ?? null,
            quantity: l.quantity,
            unit: l.unit,
            wastePct: l.wastePct,
            unitsPerProductUnit: l.unitsPerProductUnit,
            note: null,
          };
        });
        // A replace only swaps the lines + the fields the CSV states; the menu
        // price, names, notes and flags the CSV leaves blank are KEPT.
        const parsedInput = recipeInput.safeParse({
          id: ex?.id,
          name: ex?.name ?? r.name,
          nameEn: r.nameEn ?? ex?.nameEn ?? null,
          category: r.category ?? ex?.category ?? null,
          isSubRecipe: isSub(r),
          yieldQty: r.yieldQty,
          yieldUnit: r.yieldUnit,
          menuPriceAgorot: r.menuPriceAgorot ?? ex?.menuPriceAgorot ?? null,
          menuPriceIncludesVat: ex?.menuPriceIncludesVat ?? true,
          active: ex?.active ?? true,
          notes: ex?.notes ?? null,
          items,
        });
        // Unreachable after the checks above; if it ever happens the whole import rolls back.
        if (!parsedInput.success) fail('BAD_REQUEST', 'importFailed');
        const id = await writeRecipe(ctx.db, rid, parsedInput.data);
        idByName.set(key(r.name), id);
      }
      return { ok: true, errors: [], recipes: preview };
    }),
});
