import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, eq, inArray, inventoryCountLines, inventoryCounts, products, sql, type Database } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { chefProcedure, memberProcedure, router } from '../trpc';
import { costRecipes } from '../recipes/cost';
import { latestPrices, loadPosSales, loadRecipes, loadRestaurant, toCostRecipes } from '../recipes/data';
import { posVsTheory } from '../recipes/pos';
import {
  assertInventoryEnabled,
  completedCounts,
  defaultArea,
  endOfLocalDate,
  isFood,
  loadCount,
  loadDraft,
  loadLines,
  localToday,
  pricesAsOf,
  productsById,
  purchasesInPeriod,
  recentlyBoughtProducts,
} from '../inventory/data';
import { actualFoodCost, STORAGE_AREAS, valueCount, type CountLineInput } from '../inventory/valuation';

/**
 * Inventory counting (ספירת מלאי) → actual food cost per period. Flag
 * `inventoryCount` (FORBIDDEN / FEATURE_DISABLED when off). Owner, manager and
 * chef count; everything runs in the member RLS transaction and filters on the
 * caller's restaurant_id, so a foreign id resolves to nothing.
 */

const inventoryProcedure = chefProcedure.use(async ({ ctx, next }) => {
  const rc = await assertInventoryEnabled(ctx.db, ctx.session.restaurantId);
  return next({ ctx: { ...ctx, rc } });
});

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s), 'invalid date');
const QTY = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'qty');
const AREA = z.enum(STORAGE_AREAS);
const SALES = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'sales');

/** Serialises writes to one restaurant's counts (autosave vs finish). */
async function lockCounts(db: Database, restaurantId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${restaurantId}`}))`);
}

function notDraft(): never {
  throw new TRPCError({ code: 'CONFLICT', message: 'count is not a draft' });
}

/** A draft count with its lines, live-valued at the draft date's prices. */
async function draftView(db: Database, restaurantId: string, tz: string, countId: string) {
  const c = await loadCount(db, restaurantId, countId);
  const lines = await loadLines(db, restaurantId, countId);
  const prices = await pricesAsOf(db, restaurantId, c.countDate, tz, lines.map((l) => l.productId));
  const sum = valueCount(lines.map((l): CountLineInput => ({ productId: l.productId, qty: l.qty, unit: l.unit })), prices);
  return {
    id: c.id,
    countDate: c.countDate,
    status: c.status as 'draft' | 'completed',
    notes: c.notes,
    foodSalesExVat: c.foodSalesExVat,
    totalValueAgorot: c.status === 'completed' ? Number(c.totalValueAgorot ?? 0) : sum.totalValueAgorot,
    progress: { lines: sum.lines, counted: sum.counted, notCounted: sum.notCounted, unpriced: sum.unpriced },
    lines: lines.map((l) => {
      const v = sum.values.get(l.productId)!;
      const snap = c.status === 'completed';
      return {
        productId: l.productId,
        name: l.name,
        nameEn: l.nameEn,
        storageArea: l.storageArea as (typeof STORAGE_AREAS)[number],
        qty: l.qty,
        unit: l.unit,
        // A completed count shows its snapshot, never today's prices.
        unitCost: snap ? l.unitCost : v.unitCost,
        valueAgorot: snap ? (l.valueAgorot == null ? null : Number(l.valueAgorot)) : v.valueAgorot,
        status: snap ? (l.qty == null ? 'notCounted' : l.valueAgorot == null ? 'noPrice' : 'ok') : v.status,
      };
    }),
  };
}

/** Actual food cost between the completed count before `closing` and `closing`. */
async function periodFor(db: Database, restaurantId: string, rc: Awaited<ReturnType<typeof loadRestaurant>>, closingId?: string) {
  const done = await completedCounts(db, restaurantId, 48);
  const closing = closingId ? done.find((c) => c.id === closingId) : done[0];
  if (!closing) return { available: false as const, reason: closingId ? ('notFound' as const) : ('noCounts' as const) };
  const opening = done.find((c) => c.countDate < closing.countDate);
  if (!opening) return { available: false as const, reason: 'needOpening' as const, closing: { id: closing.id, countDate: closing.countDate } };
  const purchases = await purchasesInPeriod(db, restaurantId, rc.timezone, opening.countDate, closing.countDate);
  // Sales: POS (when the integration is on and has rows) else the manual figure on the closing count.
  const dayAfter = (ymd: string) => localToday(rc.timezone, endOfLocalDate(ymd, rc.timezone));
  const from = dayAfter(opening.countDate);
  let salesAgorot: number | null = null;
  let salesSource: 'pos' | 'manual' | null = null;
  let theoreticalAgorot: number | null = null;
  const pos = featureEnabled(rc.settings, 'integrations') ? await loadPosSales(db, restaurantId, from, closing.countDate) : null;
  if (pos && pos.length > 0) {
    salesAgorot = pos.reduce((a, r) => a + Math.round(Number(r.netAmount) * 100), 0);
    salesSource = 'pos';
    if (featureEnabled(rc.settings, 'recipes')) {
      const { rows, items } = await loadRecipes(db, restaurantId);
      const costInput = toCostRecipes(rows, items);
      const prices = await latestPrices(db, restaurantId, {
        before: endOfLocalDate(closing.countDate, rc.timezone),
        productIds: [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))],
      });
      const res = posVsTheory(pos, rows, costRecipes(costInput, prices, rc.vatBp));
      if (res.rows.length > 0) theoreticalAgorot = res.totals.theoreticalCostAgorot;
    }
  } else if (closing.foodSalesExVat != null) {
    salesAgorot = Math.round(Number(closing.foodSalesExVat) * 100);
    salesSource = 'manual';
  }
  const openingAgorot = Number(opening.totalValueAgorot ?? 0);
  const closingAgorot = Number(closing.totalValueAgorot ?? 0);
  const result = actualFoodCost({ openingAgorot, purchasesAgorot: purchases.purchasesAgorot, closingAgorot, salesAgorot, theoreticalAgorot });
  return {
    available: true as const,
    opening: { id: opening.id, countDate: opening.countDate, valueAgorot: openingAgorot },
    closing: { id: closing.id, countDate: closing.countDate, valueAgorot: closingAgorot },
    purchases,
    salesAgorot,
    salesSource,
    theoreticalAgorot,
    targetBp: rc.targetBp,
    ...result,
  };
}

export const inventoryRouter = router({
  /** Whether `inventoryCount` is on for the caller's restaurant (drives the nav). Never FORBIDDEN. */
  enabled: memberProcedure.query(async ({ ctx }) => {
    const rc = await loadRestaurant(ctx.db, ctx.session.restaurantId);
    return { enabled: featureEnabled(rc.settings, 'inventoryCount') };
  }),

  /** The open draft (with lines, progress and live value), or null. */
  current: inventoryProcedure.query(async ({ ctx }) => {
    const d = await loadDraft(ctx.db, ctx.session.restaurantId);
    return d ? draftView(ctx.db, ctx.session.restaurantId, ctx.rc.timezone, d.id) : null;
  }),

  /** Start a count (or return the open draft): every food product bought in the last 60 days, by storage area. */
  start: inventoryProcedure.input(z.object({ countDate: YMD.optional() }).optional()).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    await lockCounts(ctx.db, rid);
    const open = await loadDraft(ctx.db, rid);
    if (open) return { id: open.id, created: false };
    const countDate = input?.countDate ?? localToday(ctx.rc.timezone);
    if (countDate > localToday(ctx.rc.timezone)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'future date' });
    // Areas the chef used on the previous count win over the category guess.
    const [prev] = await completedCounts(ctx.db, rid, 1);
    const prevAreas = new Map(prev ? (await loadLines(ctx.db, rid, prev.id)).map((l) => [l.productId, l.storageArea] as const) : []);
    const prods = await recentlyBoughtProducts(ctx.db, rid, countDate, ctx.rc.timezone);
    const [c] = await ctx.db
      .insert(inventoryCounts)
      .values({ restaurantId: rid, countDate, status: 'draft', countedBy: ctx.session.userId })
      .returning({ id: inventoryCounts.id });
    if (prods.length > 0) {
      await ctx.db.insert(inventoryCountLines).values(
        prods.map((p) => ({
          restaurantId: rid,
          countId: c!.id,
          productId: p.id,
          storageArea: prevAreas.get(p.id) ?? defaultArea(p.category),
          unit: p.unit?.trim() || 'יח׳',
        })),
      );
    }
    return { id: c!.id, created: true };
  }),

  /**
   * Autosave: set qty (null = not counted) / storage area for lines of the open
   * draft. A product not on the count yet is added (it must be this restaurant's).
   */
  saveLines: inventoryProcedure
    .input(
      z.object({
        countId: z.string().uuid(),
        lines: z
          .array(z.object({ productId: z.string().uuid(), qty: QTY.nullable().optional(), storageArea: AREA.optional() }))
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await lockCounts(ctx.db, rid);
      const c = await loadCount(ctx.db, rid, input.countId);
      if (c.status !== 'draft') notDraft();
      const existing = new Set((await loadLines(ctx.db, rid, c.id)).map((l) => l.productId));
      const fresh = [...new Set(input.lines.map((l) => l.productId).filter((p) => !existing.has(p)))];
      const owned = await productsById(ctx.db, rid, fresh);
      for (const pid of fresh) {
        const p = owned.get(pid);
        if (!p || !isFood(p.category)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown product' });
      }
      for (const l of input.lines) {
        if (existing.has(l.productId)) {
          const set: Partial<typeof inventoryCountLines.$inferInsert> = {};
          if (l.qty !== undefined) set.qty = l.qty;
          if (l.storageArea) set.storageArea = l.storageArea;
          if (Object.keys(set).length === 0) continue;
          await ctx.db
            .update(inventoryCountLines)
            .set(set)
            .where(and(eq(inventoryCountLines.restaurantId, rid), eq(inventoryCountLines.countId, c.id), eq(inventoryCountLines.productId, l.productId)));
        } else {
          const p = owned.get(l.productId)!;
          await ctx.db.insert(inventoryCountLines).values({
            restaurantId: rid,
            countId: c.id,
            productId: l.productId,
            storageArea: l.storageArea ?? defaultArea(p.category),
            unit: p.unit?.trim() || 'יח׳',
            qty: l.qty ?? null,
          });
          existing.add(l.productId);
        }
      }
      return { ok: true as const, savedAt: new Date().toISOString() };
    }),

  /** Products to add by hand (name search, Hebrew or English; food only). */
  searchProducts: inventoryProcedure.input(z.object({ q: z.string().trim().min(1).max(64) })).query(async ({ ctx, input }) => {
    const like = `%${input.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = await ctx.db
      .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn, unit: products.defaultUnit, category: products.category })
      .from(products)
      .where(and(eq(products.restaurantId, ctx.session.restaurantId), sql`(${products.canonicalName} ilike ${like} or ${products.nameEn} ilike ${like})`))
      .limit(20);
    return rows.filter((r) => isFood(r.category));
  }),

  /** Count date / notes / manual food sales of a count (sales may be set after completion too). */
  setMeta: inventoryProcedure
    .input(
      z.object({
        countId: z.string().uuid(),
        countDate: YMD.optional(),
        notes: z.string().max(2000).nullable().optional(),
        foodSalesExVat: SALES.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await lockCounts(ctx.db, rid);
      const c = await loadCount(ctx.db, rid, input.countId);
      const set: Partial<typeof inventoryCounts.$inferInsert> = {};
      if (input.countDate !== undefined) {
        // The date drives the snapshot prices: only a draft may move.
        if (c.status !== 'draft') notDraft();
        if (input.countDate > localToday(ctx.rc.timezone)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'future date' });
        set.countDate = input.countDate;
      }
      if (input.notes !== undefined) set.notes = input.notes;
      if (input.foodSalesExVat !== undefined) set.foodSalesExVat = input.foodSalesExVat;
      if (Object.keys(set).length > 0) {
        await ctx.db.update(inventoryCounts).set(set).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
      }
      return { ok: true as const };
    }),

  /** Finish: snapshot every line's unit cost + value at the count date's prices, and the total. */
  complete: inventoryProcedure.input(z.object({ countId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    await lockCounts(ctx.db, rid);
    const c = await loadCount(ctx.db, rid, input.countId);
    if (c.status !== 'draft') notDraft();
    const lines = await loadLines(ctx.db, rid, c.id);
    const prices = await pricesAsOf(ctx.db, rid, c.countDate, ctx.rc.timezone, lines.map((l) => l.productId));
    const sum = valueCount(lines.map((l) => ({ productId: l.productId, qty: l.qty, unit: l.unit })), prices);
    if (sum.counted === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'nothing counted' });
    for (const l of lines) {
      const v = sum.values.get(l.productId)!;
      await ctx.db
        .update(inventoryCountLines)
        .set({ unitCost: v.unitCost, valueAgorot: v.valueAgorot })
        .where(and(eq(inventoryCountLines.restaurantId, rid), eq(inventoryCountLines.id, l.id)));
    }
    await ctx.db
      .update(inventoryCounts)
      .set({ status: 'completed', completedAt: new Date(), totalValueAgorot: sum.totalValueAgorot, countedBy: c.countedBy ?? ctx.session.userId })
      .where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
    return {
      id: c.id,
      countDate: c.countDate,
      totalValueAgorot: sum.totalValueAgorot,
      counted: sum.counted,
      notCounted: sum.notCounted,
      unpriced: sum.unpriced,
      unpricedNames: lines.filter((l) => { const s = sum.values.get(l.productId)!.status; return s === 'noPrice' || s === 'unitMismatch'; }).map((l) => ({ name: l.name, nameEn: l.nameEn })),
    };
  }),

  /** Throw away the open draft. */
  discard: inventoryProcedure.input(z.object({ countId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    await lockCounts(ctx.db, rid);
    const c = await loadCount(ctx.db, rid, input.countId);
    if (c.status !== 'draft') notDraft();
    await ctx.db.delete(inventoryCounts).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
    return { ok: true as const };
  }),

  /** One count (draft or completed) with its lines. */
  get: inventoryProcedure.input(z.object({ countId: z.string().uuid() })).query(({ ctx, input }) =>
    draftView(ctx.db, ctx.session.restaurantId, ctx.rc.timezone, input.countId),
  ),

  /** Completed counts, newest first, with their ₪ value and line tallies. */
  history: inventoryProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    const done = await completedCounts(ctx.db, rid, 24);
    if (done.length === 0) return [];
    const tallies = (await ctx.db
      .select({
        countId: inventoryCountLines.countId,
        lines: sql<number>`count(*)::int`,
        counted: sql<number>`count(*) filter (where ${inventoryCountLines.qty} is not null)::int`,
        unpriced: sql<number>`count(*) filter (where ${inventoryCountLines.qty} is not null and ${inventoryCountLines.valueAgorot} is null)::int`,
      })
      .from(inventoryCountLines)
      .where(and(eq(inventoryCountLines.restaurantId, rid), inArray(inventoryCountLines.countId, done.map((c) => c.id))))
      .groupBy(inventoryCountLines.countId)) as Array<{ countId: string; lines: number; counted: number; unpriced: number }>;
    const byId = new Map(tallies.map((t) => [t.countId, t] as const));
    return done.map((c) => ({
      id: c.id,
      countDate: c.countDate,
      completedAt: c.completedAt?.toISOString() ?? null,
      totalValueAgorot: Number(c.totalValueAgorot ?? 0),
      foodSalesExVat: c.foodSalesExVat,
      lines: byId.get(c.id)?.lines ?? 0,
      counted: byId.get(c.id)?.counted ?? 0,
      unpriced: byId.get(c.id)?.unpriced ?? 0,
    }));
  }),

  /**
   * Actual food cost for the period that ends at a completed count (default:
   * the latest): opening count + food purchases − closing count, vs food sales,
   * and — with recipes + POS — vs the theoretical cost ("unexplained usage").
   */
  period: inventoryProcedure.input(z.object({ closingId: z.string().uuid().optional() }).optional()).query(({ ctx, input }) =>
    periodFor(ctx.db, ctx.session.restaurantId, ctx.rc, input?.closingId),
  ),
});
