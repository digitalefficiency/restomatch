import { TRPCError } from '@trpc/server';
import { LEAK_FILTER, LIVE_DUPLICATE } from '@restomatch/charts';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  inventoryCountLines,
  inventoryCounts,
  products,
  sql,
  type Database,
} from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled } from '../lib/features';
import { addCalendarDaysInTz, startOfDayInTz } from '../lib/time';
import { latestPrices, loadRestaurant, type RestaurantCostContext } from '../recipes/data';
import type { StorageArea, UnitPrice } from './valuation';

/**
 * Tenant-scoped reads for inventory counts. Every query filters on the
 * caller's restaurant_id and runs inside the member RLS transaction.
 */

/** FORBIDDEN (appCode FEATURE_DISABLED) unless `inventoryCount` is on for this restaurant. */
export async function assertInventoryEnabled(db: Database, restaurantId: string): Promise<RestaurantCostContext> {
  const ctx = await loadRestaurant(db, restaurantId);
  if (!featureEnabled(ctx.settings, 'inventoryCount')) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'FEATURE_DISABLED:inventoryCount', { feature: 'inventoryCount' });
  }
  return ctx;
}

const ymdIn = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Today's local date (YYYY-MM-DD) in the restaurant's zone. */
export function localToday(tz: string, now = new Date()): string {
  return ymdIn(now, tz);
}

/** The first instant AFTER local date `ymd` (its next local midnight), as UTC. */
export function endOfLocalDate(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  // Noon UTC is on that local date in every zone within ±12h.
  return startOfDayInTz(addCalendarDaysInTz(new Date(Date.UTC(y, m - 1, d, 12)), 1, tz), tz);
}

/**
 * Latest PAID unit price per product on or before local date `ymd` (ex-VAT,
 * per the product's default unit) — the recipes engine's price source.
 */
export async function pricesAsOf(
  db: Database,
  restaurantId: string,
  ymd: string,
  tz: string,
  productIds: string[],
): Promise<Map<string, UnitPrice>> {
  const m = await latestPrices(db, restaurantId, { before: endOfLocalDate(ymd, tz), productIds });
  return new Map([...m].map(([pid, p]) => [pid, { unitPrice: p.unitPrice, unit: p.unit }]));
}

/** Storage-area guess for a product category (the chef can move any line). */
export function defaultArea(category: string | null): StorageArea {
  const c = (category ?? '').trim();
  if (/ירק|פיר|produce|vegetable|fruit/i.test(c)) return 'produce';
  if (/בשר|עוף|דג|חלב|meat|poultry|fish|dairy/i.test(c)) return 'fridge';
  if (/קפוא|frozen/i.test(c)) return 'freezer';
  if (/משק|יין|בירה|drink|beverage|bar|wine|beer/i.test(c)) return 'bar';
  if (/יבש|שמן|תבלין|מאפ|dry|oil|spice|bakery/i.test(c)) return 'dry';
  return 'other';
}

/** Not food: never on a count, never in food purchases. */
export const NON_FOOD_CATEGORIES = ['חד״פ', 'חד"פ', 'ניקיון', 'disposables', 'cleaning'] as const;

export function isFood(category: string | null): boolean {
  return !NON_FOOD_CATEGORIES.includes((category ?? '').trim() as (typeof NON_FOOD_CATEGORIES)[number]);
}

/** Products bought in the `days` before local date `ymd` (food only), for a new count. */
export async function recentlyBoughtProducts(
  db: Database,
  restaurantId: string,
  ymd: string,
  tz: string,
  days = 60,
): Promise<Array<{ id: string; name: string; nameEn: string | null; unit: string | null; category: string | null }>> {
  const to = endOfLocalDate(ymd, tz);
  const from = new Date(to.getTime() - days * 86_400_000);
  const rows = (await db.execute(sql`
    select p.id, p.canonical_name as name, p.name_en as "nameEn", p.default_unit as unit, p.category
    from products p
    where p.restaurant_id = ${restaurantId}
      and exists (
        select 1 from price_history ph
        where ph.restaurant_id = ${restaurantId} and ph.product_id = p.id
          and ph.observed_at >= ${from.toISOString()}::timestamptz and ph.observed_at < ${to.toISOString()}::timestamptz
      )
    order by p.category nulls last, p.canonical_name
  `)) as unknown as Array<{ id: string; name: string; nameEn: string | null; unit: string | null; category: string | null }>;
  return [...rows].filter((r) => isFood(r.category));
}

export async function loadCount(db: Database, restaurantId: string, countId: string) {
  const [c] = await db
    .select()
    .from(inventoryCounts)
    .where(and(eq(inventoryCounts.restaurantId, restaurantId), eq(inventoryCounts.id, countId)))
    .limit(1);
  if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'count not found' });
  return c;
}

export async function loadDraft(db: Database, restaurantId: string) {
  const [c] = await db
    .select()
    .from(inventoryCounts)
    .where(and(eq(inventoryCounts.restaurantId, restaurantId), eq(inventoryCounts.status, 'draft')))
    .limit(1);
  return c ?? null;
}

export async function loadLines(db: Database, restaurantId: string, countId: string) {
  return db
    .select({
      id: inventoryCountLines.id,
      productId: inventoryCountLines.productId,
      storageArea: inventoryCountLines.storageArea,
      qty: inventoryCountLines.qty,
      unit: inventoryCountLines.unit,
      unitCost: inventoryCountLines.unitCost,
      valueAgorot: inventoryCountLines.valueAgorot,
      name: products.canonicalName,
      nameEn: products.nameEn,
      category: products.category,
    })
    .from(inventoryCountLines)
    .innerJoin(products, and(eq(products.id, inventoryCountLines.productId), eq(products.restaurantId, restaurantId)))
    .where(and(eq(inventoryCountLines.restaurantId, restaurantId), eq(inventoryCountLines.countId, countId)))
    .orderBy(asc(inventoryCountLines.storageArea), asc(products.canonicalName));
}

export async function completedCounts(db: Database, restaurantId: string, limit = 24) {
  return db
    .select()
    .from(inventoryCounts)
    .where(and(eq(inventoryCounts.restaurantId, restaurantId), eq(inventoryCounts.status, 'completed')))
    .orderBy(desc(inventoryCounts.countDate), desc(inventoryCounts.completedAt))
    .limit(limit);
}

export async function productsById(db: Database, restaurantId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; category: string | null; unit: string | null }>();
  const rows = await db
    .select({ id: products.id, category: products.category, unit: products.defaultUnit })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, ids)));
  return new Map(rows.map((r) => [r.id, r] as const));
}

export interface Purchases {
  /** Food purchases ex-VAT after every exclusion below (agorot). */
  purchasesAgorot: number;
  invoiceCount: number;
  /** Σ total_excl_vat of the counted invoices (agorot). */
  invoicesAgorot: number;
  /** Non-food lines (disposables, cleaning) taken out (agorot). */
  nonFoodAgorot: number;
  /** Live duplicate copies left out — their goods are on the original (agorot, count). */
  duplicatesAgorot: number;
  duplicateCount: number;
  /** Money the suppliers gave back: accepted/resolved claims, capped per invoice (agorot). */
  creditsAgorot: number;
}

const agorot = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/**
 * Food purchases ex-VAT for local dates (fromYmd, toYmd] — the period AFTER the
 * opening count up to and including the closing count. Rules shared with the
 * leak engine (@restomatch/charts): an invoice carrying a LIVE duplicate
 * finding is a second bill for goods already counted on the original, so it
 * is left out (a duplicate the bookkeeper rejected — "not a duplicate" — is a
 * normal purchase again). Invoices still waiting for a PO link (consolidated
 * חשבוניות ריכוז) ARE purchases: the goods arrived. Delivery notes have no
 * invoice of their own, so a monthly consolidated invoice is counted once.
 * Credits = the recovered part of the leak (claims accepted/resolved).
 */
export async function purchasesInPeriod(
  db: Database,
  restaurantId: string,
  tz: string,
  fromYmd: string,
  toYmd: string,
): Promise<Purchases> {
  const nonFood = sql.join(NON_FOOD_CATEGORIES.map((c) => sql`${c}`), sql`, `);
  const [r] = (await db.execute(sql`
    with inv as (
      select
        i.id,
        coalesce(i.total_excl_vat, 0) as total_excl,
        exists (
          select 1 from match_runs mr
          join discrepancies d on d.match_run_id = mr.id and d.restaurant_id = ${restaurantId}
          where mr.invoice_id = i.id and mr.restaurant_id = ${restaurantId} and ${LIVE_DUPLICATE}
        ) as dup,
        coalesce((
          select sum(l.line_total) from invoice_lines l
          join products p on p.id = l.product_id and p.restaurant_id = ${restaurantId}
          where l.invoice_id = i.id and btrim(p.category) in (${nonFood})
        ), 0) as non_food,
        least(coalesce(i.total_excl_vat, 0), coalesce((
          select sum(abs(d.delta_amount)) from match_runs mr
          join discrepancies d on d.match_run_id = mr.id and d.restaurant_id = ${restaurantId}
          where mr.invoice_id = i.id and mr.restaurant_id = ${restaurantId}
            and ${LEAK_FILTER} and d.resolution_status in ('accepted','resolved')
        ), 0)) as credit
      from invoices i
      where i.restaurant_id = ${restaurantId}
        and (coalesce(i.invoice_date, i.created_at) at time zone ${tz})::date > ${fromYmd}::date
        and (coalesce(i.invoice_date, i.created_at) at time zone ${tz})::date <= ${toYmd}::date
    )
    select
      count(*) filter (where not dup)::int as n,
      coalesce(sum(total_excl) filter (where not dup), 0)::numeric(14,2)::text as total,
      coalesce(sum(least(non_food, total_excl)) filter (where not dup), 0)::numeric(14,2)::text as non_food,
      count(*) filter (where dup)::int as dup_n,
      coalesce(sum(total_excl) filter (where dup), 0)::numeric(14,2)::text as dup_total,
      coalesce(sum(least(credit, total_excl - least(non_food, total_excl))) filter (where not dup), 0)::numeric(14,2)::text as credit
    from inv
  `)) as unknown as Array<{ n: number; total: string; non_food: string; dup_n: number; dup_total: string; credit: string }>;
  const invoicesAgorot = agorot(r?.total);
  const nonFoodAgorot = agorot(r?.non_food);
  const creditsAgorot = agorot(r?.credit);
  return {
    purchasesAgorot: invoicesAgorot - nonFoodAgorot - creditsAgorot,
    invoiceCount: Number(r?.n ?? 0),
    invoicesAgorot,
    nonFoodAgorot,
    duplicatesAgorot: agorot(r?.dup_total),
    duplicateCount: Number(r?.dup_n ?? 0),
    creditsAgorot,
  };
}
