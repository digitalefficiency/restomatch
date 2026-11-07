import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, auditLog, desc, eq, inArray, inventoryCountLines, inventoryCounts, products, sql, users, type Database } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { chefProcedure, memberProcedure, router } from '../trpc';
import { costRecipes, parseScaled, roundHalfUp, unitFactorRational } from '../recipes/cost';
import { recordAudit, type AuditAction } from '../audit';
import { enqueueNotification } from '../notifications/outbox';
import { recipientsForRestaurant } from '../notifications/recipients';
import { fromScale4, guardLine, type GuardFlag } from '../inventory/guard';
import { latestPrices, loadPosSales, loadRecipes, loadRestaurant, toCostRecipes } from '../recipes/data';
import { posVsTheory } from '../recipes/pos';
import {
  assertInventoryEnabled,
  completedCounts,
  defaultArea,
  endOfLocalDate,
  foodValueOf,
  isFood,
  loadCount,
  loadDraft,
  loadLines,
  localToday,
  dayBefore,
  monthStartOf,
  pricesWithSourceAsOf,
  productsById,
  purchasesInPeriod,
  receivedBetween,
  recentlyBoughtProducts,
  type PricedWithSource,
} from '../inventory/data';
import { actualFoodCost, STORAGE_AREAS, valueCount, valueLine, type CountLineInput } from '../inventory/valuation';

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

/**
 * Read tier (owner decision: the bookkeeper reads everything, writes nothing).
 * Used by history / get (completed only for the bookkeeper) / period / exportCsv.
 * TODO(G-07): swap the local role list for the `inventory.read` capability.
 */
const READERS = ['owner', 'manager', 'chef', 'bookkeeper'] as const;
const inventoryReaderProcedure = memberProcedure.use(async ({ ctx, next }) => {
  if (!(READERS as readonly string[]).includes(ctx.session.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Required role: ${READERS.join('|')}, got: ${ctx.session.role}` });
  }
  const rc = await assertInventoryEnabled(ctx.db, ctx.session.restaurantId);
  return next({ ctx: { ...ctx, rc } });
});

/** Owner and manager: close a count, set the food-sales denominator. */
const CLOSERS = new Set(['owner', 'manager']);
const inventoryCloserProcedure = inventoryProcedure.use(({ ctx, next }) => {
  if (!CLOSERS.has(ctx.session.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `Required role: owner|manager, got: ${ctx.session.role}` });
  }
  return next();
});

/**
 * Owner decision: the chef counts but sees no ₪. Every ₪ field (values, unit
 * costs and their invoice sources, food sales, the period ₪) is left OUT of the
 * chef's JSON — not nulled in the UI. The bookkeeper reads everything.
 * TODO(G-07): `money.view` capability.
 */
const seesMoney = (role: string) => role === 'owner' || role === 'manager' || role === 'bookkeeper';
function noMoney(): never {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Required role: owner|manager|bookkeeper, got: chef' });
}

/**
 * Audit actions G-05 pre-adds to `AuditAction` (#185). Until that lands on this
 * base they are typed here; `recordAudit` writes them through the one audit path.
 * TODO(G-05): drop the casts once `audit.ts` carries both values.
 */
const SALES_SET = 'inventory.sales_set' as AuditAction;
const COUNT_SUBMITTED = 'inventory.count_submitted' as AuditAction;

/** The latest audit row of `action` on a count, with who did it (name, else e-mail). */
async function lastAudit(db: Database, restaurantId: string, countId: string, action: AuditAction) {
  const [r] = await db
    .select({ at: auditLog.at, userId: auditLog.userId, name: users.name, email: users.email, after: auditLog.after })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.entityType, 'inventory_count'), eq(auditLog.entityId, countId), eq(auditLog.action, action)))
    .orderBy(desc(auditLog.at))
    .limit(1);
  return r ? { at: r.at.toISOString(), userId: r.userId, by: r.name?.trim() || r.email || null, after: r.after } : null;
}

const YMD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => s >= '2000-01-01' && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s), 'invalid date');
const QTY = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'qty');
const AREA = z.enum(STORAGE_AREAS);
const SALES = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'sales');

/** Theoretical cost is compared only when recipes cover at least this share of sales. */
export const THEORY_MIN_COVERAGE_BP = 9000;

/**
 * A food cost outside this band (or negative) is a counting / entry slip, not a
 * result: shown as "בדקו את הספירה" instead of a %, never an alarm. Same idea
 * as the POS check's IMPLAUSIBLE_FOOD_COST_BP, tighter because both ends are counted.
 */
export const PLAUSIBLE_FOOD_COST_BP = { min: 500, max: 8000 } as const;

/** Below this share of food lines counted and priced, an end is "incomplete": a calm caveat, never an alarm. */
export const COUNT_MIN_COVERAGE_BP = 9500;

/** A completed count's FOOD value (no bar / beverages / non-food) and its coverage. */
async function foodEnd(db: Database, restaurantId: string, c: { id: string; countDate: string }) {
  const { valueAgorot, coverage } = foodValueOf(await loadLines(db, restaurantId, c.id));
  const covered = coverage.lines === 0 ? 10_000 : Math.floor(((coverage.counted - coverage.unpriced) * 10_000) / coverage.lines);
  return { id: c.id, countDate: c.countDate, valueAgorot, coverage: { ...coverage, bp: covered, complete: covered >= COUNT_MIN_COVERAGE_BP } };
}

/** Serialises writes to one restaurant's counts (autosave vs finish). */
async function lockCounts(db: Database, restaurantId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${restaurantId}`}))`);
}

function notDraft(): never {
  throw new TRPCError({ code: 'CONFLICT', message: 'count is not a draft' });
}

/** last count + received since, in the counted line's unit, exact at scale 4; null when it can't be judged. */
function baseQty(
  unit: string,
  prev: { qty: string | null; unit: string } | undefined,
  received: Array<{ qty: string; unit: string }> | undefined,
): { prevQty: bigint; received: bigint | null } | null {
  if (!prev || prev.qty == null) return null;
  const toLine = (q: string, u: string) => {
    const f = unitFactorRational(u, unit);
    return f ? roundHalfUp(parseScaled(q, 4) * f[0], f[1]) : null;
  };
  const p = toLine(prev.qty, prev.unit);
  if (p == null) return null;
  let r: bigint | null = 0n;
  for (const x of received ?? []) {
    const v = toLine(x.qty, x.unit);
    if (v == null) {
      r = null;
      break;
    }
    r += v;
  }
  return { prevQty: p, received: r };
}

/**
 * A count with its lines. A draft is live-valued at its date's paid prices; a
 * completed count is its snapshot (values, price sources, tallies — never
 * re-priced). Each line carries "last time" (the previous closed count's qty,
 * and what arrived since — net, closed receipts) and the guard flags; ₪ keys are
 * left out entirely for roles without money (the chef).
 */
async function draftView(db: Database, restaurantId: string, tz: string, countId: string, role: string, userId: string) {
  const c = await loadCount(db, restaurantId, countId);
  // The bookkeeper reads closed counts only (a draft is still being counted).
  if (role === 'bookkeeper' && c.status !== 'completed') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Required role: owner|manager|chef, got: bookkeeper' });
  }
  const lines = await loadLines(db, restaurantId, countId);
  const snap = c.status === 'completed';
  const ids = lines.map((l) => l.productId);
  const prices = snap ? new Map<string, PricedWithSource>() : await pricesWithSourceAsOf(db, restaurantId, c.countDate, tz, ids);
  const sum = valueCount(lines.map((l): CountLineInput => ({ productId: l.productId, qty: l.qty, unit: l.unit })), prices);
  const counted = lines.filter((l) => l.qty != null).length;
  const progress = snap
    ? { lines: lines.length, counted, notCounted: lines.length - counted, unpriced: lines.filter((l) => l.qty != null && l.valueAgorot == null).length }
    : { lines: sum.lines, counted: sum.counted, notCounted: sum.notCounted, unpriced: sum.unpriced };
  // Last time: the previous completed count before this one, and what arrived since.
  const done = await completedCounts(db, restaurantId, 48);
  const prev = done.find((x) => x.id !== c.id && x.countDate < c.countDate);
  // A draft on or before the latest closed count can't be closed (NOT_AFTER_LAST): said up front.
  const lastClosedDate = done.find((x) => x.id !== c.id)?.countDate ?? null;
  const prevLines = prev ? new Map((await loadLines(db, restaurantId, prev.id)).map((l) => [l.productId, l] as const)) : new Map();
  const received = prev ? await receivedBetween(db, restaurantId, tz, prev.countDate, c.countDate, ids) : new Map();
  const money = seesMoney(role);
  const out = lines.map((l) => {
    const v = sum.values.get(l.productId)!;
    // A draft line not counted yet still carries its ₪/unit (money viewers), so the guard can price the first keystroke.
    const priced = !snap && v.unitCost == null && v.status === 'notCounted' ? prices.get(l.productId) : undefined;
    const unitCost = snap ? l.unitCost : (v.unitCost ?? (priced ? valueLine('1', l.unit, priced).unitCost : null));
    const valueAgorot = snap ? (l.valueAgorot == null ? null : Number(l.valueAgorot)) : v.valueAgorot;
    const priceSource = snap ? (l.priceSource ?? null) : (prices.get(l.productId)?.source ?? null);
    const pl = prevLines.get(l.productId) as { qty: string | null; unit: string } | undefined;
    const base = baseQty(l.unit, pl, received.get(l.productId));
    const baseTotal = base && base.received != null ? base.prevQty + base.received : null;
    const flags = guardLine({ qty: l.qty, base: baseTotal == null ? null : fromScale4(baseTotal), valueAgorot });
    const line = {
      productId: l.productId,
      name: l.name,
      nameEn: l.nameEn,
      storageArea: l.storageArea as (typeof STORAGE_AREAS)[number],
      qty: l.qty,
      unit: l.unit,
      status: snap ? (l.qty == null ? 'notCounted' : l.valueAgorot == null ? 'noPrice' : 'ok') : v.status,
      /** Last time, muted and never prefilled: the previous closed count's qty (in its own unit). */
      prevQty: pl?.qty ?? null,
      prevUnit: pl?.unit ?? null,
      /** Net received since the previous count, in this line's unit (null: no previous count / unit doesn't convert). */
      receivedSince: base && base.received != null ? fromScale4(base.received) : null,
      /** Last count + received since, in this line's unit: the guard's base. */
      expectedQty: baseTotal == null ? null : fromScale4(baseTotal),
      /** "בדוק": more than the last count + everything received since (the pre-W2-07 sanity check, kept). */
      check: baseTotal != null && l.qty != null ? parseScaled(l.qty, 4) > baseTotal : false,
      /** The saved qty's guard flags (the ₪2,000 rule rides here for roles that see no ₪). */
      flags,
      valueFlag: flags.includes('value'),
    };
    // A completed count shows its snapshot, never today's prices. No ₪ keys at all for the chef.
    const prevValueAgorot = (pl as { valueAgorot?: number | string | null } | undefined)?.valueAgorot;
    const moneyPart = { unitCost, valueAgorot, priceSource, prevValueAgorot: prevValueAgorot == null ? null : Number(prevValueAgorot) };
    return (money ? { ...line, ...moneyPart } : line) as typeof line & Partial<typeof moneyPart>;
  });
  const total = c.status === 'completed' ? Number(c.totalValueAgorot ?? 0) : sum.totalValueAgorot;
  const food = foodValueOf(lines.map((l) => ({ ...l, valueAgorot: snap ? l.valueAgorot : sum.values.get(l.productId)!.valueAgorot })));
  const submitted = c.status === 'draft' ? await lastAudit(db, restaurantId, c.id, COUNT_SUBMITTED) : null;
  const view = {
    id: c.id,
    countDate: c.countDate,
    status: c.status as 'draft' | 'completed',
    notes: c.notes,
    completedAt: c.completedAt?.toISOString() ?? null,
    /** False for the chef: no ₪ key is in this JSON, so the UI shows quantities only. */
    showMoney: money,
    progress,
    /** Owner/manager close (and lock) a count; the chef counts and hands off. Owner alone amends a closed one. */
    canClose: CLOSERS.has(role),
    canSubmit: c.status === 'draft' && role !== 'bookkeeper',
    /** Discard: the count's starter, or a manager+ (server-enforced in `discard`). */
    canDiscard: c.status === 'draft' && (CLOSERS.has(role) || c.countedBy === userId),
    lastClosedDate,
    canAmend: role === 'owner',
    /** The chef's hand-off ("שלחו לסגירה"): from the latest audit row until the status column lands (H-04). */
    submittedAt: submitted?.at ?? null,
    submittedBy: submitted?.by ?? null,
    lines: out,
  };
  type MoneyKeys = {
    foodSalesExVat: string | null;
    totalValueAgorot: number;
    /** Food only (no bar / beverages / non-food): the figure food cost uses. */
    foodValueAgorot: number;
  };
  // Keys absent (not null) for the chef; typed optional so readers check `showMoney`.
  return (money ? { ...view, foodSalesExVat: c.foodSalesExVat, totalValueAgorot: total, foodValueAgorot: food.valueAgorot } : view) as typeof view & Partial<MoneyKeys>;
}

/** Who set the closing count's food sales, and when ("הוזן ע״י …"): the latest `inventory.sales_set` row. */
async function salesEntryOf(db: Database, restaurantId: string, countId: string) {
  const a = await lastAudit(db, restaurantId, countId, SALES_SET);
  return a ? { by: a.by, at: a.at } : null;
}

type Period = Awaited<ReturnType<typeof periodFor>>;

/** The chef's view of a period: percentages and dates only — no ₪ key of any kind. */
function chefPeriod(p: Period) {
  if (!p.available) {
    if (p.reason === 'needOpening') {
      return { available: false as const, reason: p.reason, showMoney: false as const, closingDate: p.closing.countDate, purchaseFoodCostBp: p.purchaseFoodCost.bp };
    }
    return { available: false as const, reason: p.reason, showMoney: false as const };
  }
  return {
    available: true as const,
    showMoney: false as const,
    openingDate: p.opening.countDate,
    closingDate: p.closing.countDate,
    coverageComplete: p.coverageComplete,
    implausible: p.implausible,
    salesSource: p.salesSource,
    targetBp: p.targetBp,
    actualBp: p.actualBp,
    theoreticalBp: p.theoreticalBp,
    varianceBp: p.varianceBp,
    varianceAlert: p.varianceAlert,
  };
}

/** Actual food cost between the completed count before `closing` and `closing`. */
async function periodFor(db: Database, restaurantId: string, rc: Awaited<ReturnType<typeof loadRestaurant>>, closingId?: string) {
  const done = await completedCounts(db, restaurantId, 48);
  const closing = closingId ? done.find((c) => c.id === closingId) : done[0];
  if (!closing) return { available: false as const, reason: closingId ? ('notFound' as const) : ('noCounts' as const) };
  const opening = done.find((c) => c.countDate < closing.countDate);
  if (!opening) {
    // First month: no opening count, so no actual food cost — never an invented
    // opening value. "פוד קוסט רכש" instead: the month's food purchases (receipt
    // dates) ÷ the sales entered on this count, labelled as such.
    const from = dayBefore(monthStartOf(closing.countDate));
    const purchases = await purchasesInPeriod(db, restaurantId, rc.timezone, from, closing.countDate);
    const salesAgorot = closing.foodSalesExVat == null ? null : Math.round(Number(closing.foodSalesExVat) * 100);
    const net = purchases.purchasesAgorot - purchases.creditsAgorot;
    return {
      available: false as const,
      reason: 'needOpening' as const,
      salesEntry: await salesEntryOf(db, restaurantId, closing.id),
      closing: await foodEnd(db, restaurantId, closing),
      purchaseFoodCost: {
        from: monthStartOf(closing.countDate),
        to: closing.countDate,
        purchasesAgorot: net,
        salesAgorot,
        bp: salesAgorot && salesAgorot > 0 ? Number(roundHalfUp(BigInt(net) * 10_000n, BigInt(salesAgorot))) : null,
      },
    };
  }
  const purchases = await purchasesInPeriod(db, restaurantId, rc.timezone, opening.countDate, closing.countDate);
  // Sales: POS (when the integration is on and has rows) else the manual figure on the closing count.
  const dayAfter = (ymd: string) => localToday(rc.timezone, endOfLocalDate(ymd, rc.timezone));
  const from = dayAfter(opening.countDate);
  let salesAgorot: number | null = null;
  let salesSource: 'pos' | 'manual' | null = null;
  let theoreticalAgorot: number | null = null;
  let theoreticalCoverageBp: number | null = null;
  let theoreticalIncomplete = false;
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
      // Theory only covers POS items that have a recipe. Compare like with like:
      // only when recipes cover ≥ 90% of the period's sales and every matched
      // recipe is fully costed, scaled up to all sales; otherwise it is partial
      // (shown calmly, never an alarm).
      const matched = res.totals.netSalesAgorot;
      theoreticalCoverageBp = salesAgorot > 0 ? Math.min(10_000, Math.round((matched * 10_000) / salesAgorot)) : 0;
      theoreticalIncomplete = res.rows.some((r) => r.costIncomplete);
      if (res.rows.length > 0 && matched > 0 && theoreticalCoverageBp >= THEORY_MIN_COVERAGE_BP && !theoreticalIncomplete) {
        theoreticalAgorot = Math.round((res.totals.theoreticalCostAgorot * salesAgorot) / matched);
      }
    }
  } else if (closing.foodSalesExVat != null) {
    salesAgorot = Math.round(Number(closing.foodSalesExVat) * 100);
    salesSource = 'manual';
  }
  const openEnd = await foodEnd(db, restaurantId, opening);
  const closeEnd = await foodEnd(db, restaurantId, closing);
  // An end with uncounted / unpriced food lines understates stock: the % is shown with a caveat, and no variance alarm.
  const coverageComplete = openEnd.coverage.complete && closeEnd.coverage.complete;
  const raw = actualFoodCost({
    openingAgorot: openEnd.valueAgorot,
    purchasesAgorot: purchases.purchasesAgorot,
    creditsAgorot: purchases.creditsAgorot,
    closingAgorot: closeEnd.valueAgorot,
    salesAgorot,
    theoreticalAgorot: null,
  });
  const implausible =
    raw.actualAgorot < 0 || (raw.actualBp != null && (raw.actualBp < PLAUSIBLE_FOOD_COST_BP.min || raw.actualBp > PLAUSIBLE_FOOD_COST_BP.max));
  const result = actualFoodCost({
    openingAgorot: openEnd.valueAgorot,
    purchasesAgorot: purchases.purchasesAgorot,
    creditsAgorot: purchases.creditsAgorot,
    closingAgorot: closeEnd.valueAgorot,
    salesAgorot,
    theoreticalAgorot: coverageComplete && !implausible ? theoreticalAgorot : null,
  });
  return {
    available: true as const,
    salesEntry: await salesEntryOf(db, restaurantId, closing.id),
    opening: openEnd,
    closing: closeEnd,
    coverageComplete,
    /** A negative or out-of-band result: "check the count", never a % to act on. */
    implausible,
    purchases,
    salesAgorot,
    salesSource,
    theoreticalAgorot,
    /** Share of sales whose dishes have a recipe (null without POS + recipes). */
    theoreticalCoverageBp,
    theoreticalIncomplete,
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
    return d ? draftView(ctx.db, ctx.session.restaurantId, ctx.rc.timezone, d.id, ctx.session.role, ctx.session.userId) : null;
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

  /**
   * Count date / notes of a count. Food sales are NOT here any more: they are the
   * food-cost denominator and go through `setSales` (manager tier, audited).
   * `.strict()`: a `foodSalesExVat` key is rejected for every role.
   */
  setMeta: inventoryProcedure
    .input(
      z
        .object({
          countId: z.string().uuid(),
          countDate: YMD.optional(),
          notes: z.string().max(2000).nullable().optional(),
        })
        .strict(),
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
      if (Object.keys(set).length > 0) {
        await ctx.db.update(inventoryCounts).set(set).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
      }
      return { ok: true as const };
    }),

  /**
   * The period's food sales ex-VAT (the food-cost denominator) — owner or
   * manager only, on a draft or a closed count, every change audited with
   * before/after (`inventory.sales_set`). The PeriodCard shows who set it.
   */
  setSales: inventoryCloserProcedure
    .input(z.object({ countId: z.string().uuid(), foodSalesExVat: SALES.nullable() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await lockCounts(ctx.db, rid);
      const c = await loadCount(ctx.db, rid, input.countId);
      const before = c.foodSalesExVat ?? null;
      const after = input.foodSalesExVat == null ? null : Number(input.foodSalesExVat).toFixed(2);
      if (before != null && after != null && Number(before).toFixed(2) === after) return { ok: true as const, changed: false };
      if (before == null && after == null) return { ok: true as const, changed: false };
      await ctx.db.update(inventoryCounts).set({ foodSalesExVat: after }).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
      await recordAudit(ctx.db, {
        restaurantId: rid,
        userId: ctx.session.userId,
        action: SALES_SET,
        entityType: 'inventory_count',
        entityId: c.id,
        before: { foodSalesExVat: before, status: c.status },
        after: { foodSalesExVat: after, status: c.status },
      });
      return { ok: true as const, changed: true };
    }),

  /**
   * The chef's hand-off: "סיימתי לספור · שלחו לסגירה". One audit row
   * (`inventory.count_submitted`) and one e-mail per owner/manager at a concrete
   * address (never a `role:` target). A replay adds nothing: the audit row is the
   * marker and each notification carries a per-count, per-recipient dedupe key.
   * TODO(G-06): route through `notify()` (quiet hours 23:00–06:00 / Shabbat, ≤6 a day).
   */
  submitForClose: inventoryProcedure.input(z.object({ countId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    await lockCounts(ctx.db, rid);
    const c = await loadCount(ctx.db, rid, input.countId);
    if (c.status !== 'draft') notDraft();
    const already = await lastAudit(ctx.db, rid, c.id, COUNT_SUBMITTED);
    if (already) return { submittedAt: already.at, replay: true as const, notified: 0 };
    const lines = await loadLines(ctx.db, rid, c.id);
    const counted = lines.filter((l) => l.qty != null).length;
    await recordAudit(ctx.db, {
      restaurantId: rid,
      userId: ctx.session.userId,
      action: COUNT_SUBMITTED,
      entityType: 'inventory_count',
      entityId: c.id,
      after: { countDate: c.countDate, counted, lines: lines.length },
    });
    const to = (await recipientsForRestaurant(ctx.db, rid, ['owner', 'manager'])).filter((r) => r.userId !== ctx.session.userId);
    let notified = 0;
    for (const r of to) {
      const res = await enqueueNotification(ctx.db, {
        restaurantId: rid,
        channel: 'email',
        target: r.email,
        subject: `ספירת מלאי מוכנה לסגירה · ${counted}/${lines.length}`,
        body: `ספירת המלאי מ-${c.countDate} מוכנה לסגירה: ${counted} מתוך ${lines.length} פריטים נספרו. פתחו את מסך ספירת המלאי כדי לבדוק ולסגור.`,
        payload: { kind: 'inventory.count_submitted', countId: c.id, counted, lines: lines.length },
        relatedEntityType: 'inventory_count',
        relatedEntityId: c.id,
        dedupeKey: `inventory.count_submitted:${c.id}:${r.userId}`,
      });
      if (!res.deduped) notified += 1;
    }
    return { submittedAt: new Date().toISOString(), replay: false as const, notified };
  }),

  /**
   * Close (and lock) the count — owner or manager. Every line's unit cost,
   * value and price source are snapshotted at the count date's paid prices,
   * plus the total. Blank lines stay "not counted" (never 0): closing with any
   * needs `acceptUncounted`. Logged to the audit trail.
   */
  complete: inventoryProcedure
    .input(
      z.object({
        countId: z.string().uuid(),
        acceptUncounted: z.boolean().optional(),
        /** Product ids whose guard flags the closer confirmed ("נכון"); recorded in the close audit. */
        confirmedFlags: z.array(z.string().uuid()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      if (!CLOSERS.has(ctx.session.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'only an owner or manager closes a count' });
      await lockCounts(ctx.db, rid);
      const c = await loadCount(ctx.db, rid, input.countId);
      if (c.status !== 'draft') notDraft();
      const lines = await loadLines(ctx.db, rid, c.id);
      const prices = await pricesWithSourceAsOf(ctx.db, rid, c.countDate, ctx.rc.timezone, lines.map((l) => l.productId));
      const sum = valueCount(lines.map((l) => ({ productId: l.productId, qty: l.qty, unit: l.unit })), prices);
      if (sum.counted === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'nothing counted' });
      // Periods run closed count → closed count: a count on or before the latest closed one would split a closed period.
      const [last] = await completedCounts(ctx.db, rid, 1);
      if (last && c.countDate <= last.countDate) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `NOT_AFTER_LAST:${last.countDate}` });
      }
      const uncounted = lines.filter((l) => l.qty == null);
      if (uncounted.length > 0 && !input.acceptUncounted) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `UNCOUNTED:${uncounted.length}` });
      }
      // The guard: the screen blocks Finish until every flag is confirmed; the audit keeps what was flagged and confirmed.
      const flagView = await draftView(ctx.db, rid, ctx.rc.timezone, c.id, ctx.session.role, ctx.session.userId);
      const flagged = flagView.lines.filter((l) => l.flags.length > 0);
      const confirmed = new Set(input.confirmedFlags ?? []);
      for (const l of lines) {
        const v = sum.values.get(l.productId)!;
        await ctx.db
          .update(inventoryCountLines)
          .set({ unitCost: v.unitCost, valueAgorot: v.valueAgorot, priceSource: v.status === 'ok' ? (prices.get(l.productId)?.source ?? null) : null })
          .where(and(eq(inventoryCountLines.restaurantId, rid), eq(inventoryCountLines.id, l.id)));
      }
      const completedAt = new Date();
      await ctx.db
        .update(inventoryCounts)
        .set({ status: 'completed', completedAt, totalValueAgorot: sum.totalValueAgorot, countedBy: c.countedBy ?? ctx.session.userId })
        .where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
      await recordAudit(ctx.db, {
        restaurantId: rid,
        userId: ctx.session.userId,
        action: 'inventory.count_closed',
        entityType: 'inventory_count',
        entityId: c.id,
        after: {
          countDate: c.countDate,
          totalValueAgorot: sum.totalValueAgorot,
          counted: sum.counted,
          notCounted: sum.notCounted,
          unpriced: sum.unpriced,
          flaggedLines: flagged.map((l) => ({ productId: l.productId, qty: l.qty, unit: l.unit, flags: l.flags, confirmed: confirmed.has(l.productId) })),
        },
      });
      const view = flagView;
      return {
        id: c.id,
        countDate: c.countDate,
        totalValueAgorot: sum.totalValueAgorot,
        counted: sum.counted,
        notCounted: sum.notCounted,
        unpriced: sum.unpriced,
        unpricedNames: lines.filter((l) => { const st = sum.values.get(l.productId)!.status; return st === 'noPrice' || st === 'unitMismatch'; }).map((l) => ({ name: l.name, nameEn: l.nameEn })),
        uncountedNames: uncounted.map((l) => ({ name: l.name, nameEn: l.nameEn })),
        checkNames: view.lines.filter((l) => l.check).map((l) => ({ name: l.name, nameEn: l.nameEn })),
        foodValueAgorot: foodValueOf(lines.map((l) => ({ ...l, valueAgorot: sum.values.get(l.productId)!.valueAgorot }))).valueAgorot,
      };
    }),

  /**
   * Correct one line of a CLOSED count — owner only, with a reason. The
   * snapshot unit cost is kept (the price as of the count date); the line value
   * and the count total are recomputed. Logged with before/after/reason.
   */
  amendLine: inventoryProcedure
    .input(z.object({ countId: z.string().uuid(), productId: z.string().uuid(), qty: QTY.nullable(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      if (ctx.session.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: 'only the owner amends a closed count' });
      await lockCounts(ctx.db, rid);
      const c = await loadCount(ctx.db, rid, input.countId);
      if (c.status !== 'completed') throw new TRPCError({ code: 'CONFLICT', message: 'count is not closed' });
      const lines = await loadLines(ctx.db, rid, c.id);
      const l = lines.find((x) => x.productId === input.productId);
      if (!l) throw new TRPCError({ code: 'NOT_FOUND', message: 'line not found' });
      const v = l.unitCost == null ? null : valueLine(input.qty, l.unit, { unitPrice: l.unitCost, unit: l.unit });
      const valueAgorot = v && v.status === 'ok' ? v.valueAgorot : null;
      await ctx.db
        .update(inventoryCountLines)
        .set({ qty: input.qty, valueAgorot })
        .where(and(eq(inventoryCountLines.restaurantId, rid), eq(inventoryCountLines.id, l.id)));
      const total = lines.reduce((a, x) => a + (x.id === l.id ? (valueAgorot ?? 0) : Number(x.valueAgorot ?? 0)), 0);
      await ctx.db.update(inventoryCounts).set({ totalValueAgorot: total }).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
      await recordAudit(ctx.db, {
        restaurantId: rid,
        userId: ctx.session.userId,
        action: 'inventory.line_amended',
        entityType: 'inventory_count',
        entityId: c.id,
        before: { productId: l.productId, qty: l.qty, valueAgorot: l.valueAgorot == null ? null : Number(l.valueAgorot), totalValueAgorot: Number(c.totalValueAgorot ?? 0) },
        after: { productId: l.productId, qty: input.qty, valueAgorot, totalValueAgorot: total, reason: input.reason },
      });
      return { totalValueAgorot: total };
    }),

  /** A closed count as CSV for the accountant (item, unit, qty, unit cost, value, area, price source). */
  exportCsv: inventoryReaderProcedure.input(z.object({ countId: z.string().uuid() })).query(async ({ ctx, input }) => {
    if (!seesMoney(ctx.session.role)) noMoney();
    const rid = ctx.session.restaurantId;
    const c = await loadCount(ctx.db, rid, input.countId);
    if (c.status !== 'completed') throw new TRPCError({ code: 'CONFLICT', message: 'count is not closed' });
    const lines = await loadLines(ctx.db, rid, c.id);
    const cell = (v: unknown) => {
      const t = v == null ? '' : String(v);
      // Quote every cell; neutralise spreadsheet formulas (= + - @ at the start).
      const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const ils2 = (agorot: number | null | undefined) => (agorot == null ? '' : (Number(agorot) / 100).toFixed(2));
    const head = ['item', 'item_en', 'area', 'qty', 'unit', 'unit_cost_ex_vat', 'value_ex_vat', 'price_invoice', 'price_invoice_date', 'price_supplier'];
    const rows = lines.map((l) =>
      [
        l.name,
        l.nameEn,
        l.storageArea,
        l.qty == null ? '' : l.qty,
        l.unit,
        l.unitCost ?? '',
        ils2(l.valueAgorot == null ? null : Number(l.valueAgorot)),
        l.priceSource?.invoiceNumber ?? '',
        l.priceSource?.invoiceDate ?? '',
        l.priceSource?.supplierName ?? '',
      ].map(cell).join(','),
    );
    const total = ['TOTAL', '', '', '', '', '', ils2(Number(c.totalValueAgorot ?? 0)), '', '', ''].map(cell).join(',');
    return { filename: `inventory-count-${c.countDate}.csv`, csv: `﻿${[head.map(cell).join(','), ...rows, total].join('\r\n')}\r\n` };
  }),

  /** Throw away the open draft. */
  discard: inventoryProcedure.input(z.object({ countId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    await lockCounts(ctx.db, rid);
    const c = await loadCount(ctx.db, rid, input.countId);
    if (c.status !== 'draft') notDraft();
    // Only the count's starter or a manager+ throws a count away (the audit row stays; a hard delete, no schema change).
    if (!CLOSERS.has(ctx.session.role) && c.countedBy !== ctx.session.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'only the starter or a manager discards a count' });
    }
    const counted = (await loadLines(ctx.db, rid, c.id)).filter((l) => l.qty != null).length;
    await ctx.db.delete(inventoryCounts).where(and(eq(inventoryCounts.restaurantId, rid), eq(inventoryCounts.id, c.id)));
    await recordAudit(ctx.db, { restaurantId: rid, userId: ctx.session.userId, action: 'inventory.count_discarded', entityType: 'inventory_count', entityId: c.id, before: { countDate: c.countDate, counted } });
    return { ok: true as const };
  }),

  /** One count (draft or completed) with its lines. */
  get: inventoryReaderProcedure.input(z.object({ countId: z.string().uuid() })).query(({ ctx, input }) =>
    draftView(ctx.db, ctx.session.restaurantId, ctx.rc.timezone, input.countId, ctx.session.role, ctx.session.userId),
  ),

  /** Completed counts, newest first, with their ₪ value (null for the chef) and line tallies. */
  history: inventoryReaderProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    const money = seesMoney(ctx.session.role);
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
    const foodById = new Map<string, number>();
    if (money) for (const c of done) foodById.set(c.id, foodValueOf(await loadLines(ctx.db, rid, c.id)).valueAgorot);
    return done.map((c) => {
      const row = {
        id: c.id,
        countDate: c.countDate,
        completedAt: c.completedAt?.toISOString() ?? null,
        lines: byId.get(c.id)?.lines ?? 0,
        counted: byId.get(c.id)?.counted ?? 0,
        unpriced: byId.get(c.id)?.unpriced ?? 0,
      };
      // No ₪ keys for the chef. Food = the food-cost figure; total = incl. bar and beverages.
      return (
        money ? { ...row, totalValueAgorot: Number(c.totalValueAgorot ?? 0), foodValueAgorot: foodById.get(c.id) ?? 0, foodSalesExVat: c.foodSalesExVat } : row
      ) as typeof row & Partial<{ totalValueAgorot: number; foodValueAgorot: number; foodSalesExVat: string | null }>;
    });
  }),

  /**
   * Actual food cost for the period that ends at a completed count (default:
   * the latest): opening count + food purchases − closing count, vs food sales,
   * and — with recipes + POS — vs the theoretical cost ("unexplained usage").
   */
  period: inventoryReaderProcedure.input(z.object({ closingId: z.string().uuid().optional() }).optional()).query(({ ctx, input }) => {
    // The period is all ₪ (purchases, credits, sales, food cost): owner, manager and bookkeeper. The chef reads `periodPercent`.
    if (!seesMoney(ctx.session.role)) noMoney();
    return periodFor(ctx.db, ctx.session.restaurantId, ctx.rc, input?.closingId);
  }),

  /** The same period as percentages and dates only — the chef's food cost (owner decision: % only, no ₪ key). */
  periodPercent: inventoryReaderProcedure.input(z.object({ closingId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) =>
    chefPeriod(await periodFor(ctx.db, ctx.session.restaurantId, ctx.rc, input?.closingId)),
  ),
});
