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
  invoices,
  lt,
  priceHistory,
  products,
  sql,
  suppliers,
  type Database,
  type InventoryPriceSource,
} from '@restomatch/db';

type SQL = ReturnType<typeof sql>;
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

/**
 * Not food: never on a count, never in food purchases. Categories are free
 * text, so this is a pattern (case-insensitive) over the usual spellings:
 * חד״פ / חד"פ / חד פעמי, ניקיון / ניקוי / חומרי ניקוי, disposables, cleaning.
 * The same source drives the SQL (~*) and isFood().
 */
export const NON_FOOD_PATTERN = "(חד[״\"׳'\\s]*פ|חד[\\s-]?פעמי|ניקיון|ניקוי|disposab|cleaning)";
const NON_FOOD_RE = new RegExp(NON_FOOD_PATTERN, 'i');

export function isFood(category: string | null): boolean {
  return !NON_FOOD_RE.test(category ?? '');
}

/**
 * Beverages (משקאות, wine, beer…): counted (on the bar shelf) but not FOOD
 * cost — the % is of food sales, so their purchases, credits and stock stay out.
 */
export const BEVERAGE_PATTERN = '(משקא|יין|בירה|drink|beverage|wine|beer)';
const BEVERAGE_RE = new RegExp(BEVERAGE_PATTERN, 'i');

/** Does a counted line belong in food cost? Food category, not a beverage, not on the bar shelf. */
export function isFoodCost(category: string | null, storageArea: string): boolean {
  return isFood(category) && !BEVERAGE_RE.test(category ?? '') && storageArea !== 'bar';
}

/** Goods-line overcharges: the findings a supplier credits. Never VAT, price-lower or missing-on-invoice. */
export const CREDIT_TYPES = ['PRICE_HIGHER', 'QTY_OVER', 'UNORDERED_ITEM', 'QTY_SHORT'] as const;

/** A count's FOOD value and coverage (bar / beverage / non-food lines left out), from its lines. */
export function foodValueOf(lines: Array<{ category: string | null; storageArea: string; qty: string | null; valueAgorot: number | string | null }>) {
  const food = lines.filter((l) => isFoodCost(l.category, l.storageArea));
  const counted = food.filter((l) => l.qty != null);
  return {
    valueAgorot: counted.reduce((a, l) => a + Number(l.valueAgorot ?? 0), 0),
    coverage: { lines: food.length, counted: counted.length, unpriced: counted.filter((l) => l.valueAgorot == null).length },
  };
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
      priceSource: inventoryCountLines.priceSource,
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
  /**
   * Food purchases ex-VAT on RECEIPT dates: the period's invoices − non-food
   * lines + delivery notes received but not billed yet − earlier notes billed in
   * this period (agorot). Credits received are a separate term.
   */
  purchasesAgorot: number;
  invoiceCount: number;
  /** Σ total_excl_vat of the counted invoices (agorot). */
  invoicesAgorot: number;
  /** Non-food lines (disposables, cleaning) taken out (agorot). */
  nonFoodAgorot: number;
  /** Beverage lines taken out: not food cost (agorot). */
  beverageAgorot: number;
  /** Invoices with no ex-VAT total and no incl − VAT to fall back on: counted as ₪0, shown as an FYI. */
  missingTotalCount: number;
  /** Live duplicate copies left out — their goods are on the original (agorot, count). */
  duplicatesAgorot: number;
  duplicateCount: number;
  /**
   * "זיכויים שהתקבלו": goods-line overcharge claims (CREDIT_TYPES, Δ ≠ 0) on food
   * lines whose credit was RECEIVED (resolved) in the period — dated by
   * resolved_at — capped at the invoice's food value (agorot).
   */
  creditsAgorot: number;
  /** "זיכוי לקבל": claims accepted but the credit not received yet — shown, never subtracted (agorot). */
  creditsToReceiveAgorot: number;
  /** Delivery notes received in the period, not billed yet: added at PO prices (agorot, count). */
  accruedAgorot: number;
  accruedNotes: number;
  /** Notes received before the period whose consolidated invoice lands in it: taken back out (agorot). */
  reversedAgorot: number;
}

const agorot = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/**
 * Food purchases ex-VAT for local dates (fromYmd, toYmd] — the period AFTER the
 * opening count up to and including the closing count — on RECEIPT dates
 * ("לפי תאריכי קבלה"): the month closes on goods that arrived, because the
 * consolidated invoice (חשבונית הריכוז) for a month's delivery notes arrives the
 * month after.
 *
 * Rules shared with the leak engine (@restomatch/charts): an invoice carrying
 * a LIVE duplicate finding is a second bill for goods already counted on the
 * original, so it is left out (a duplicate the bookkeeper rejected — "not a
 * duplicate" — is a normal purchase again). Invoices still waiting for a PO
 * link ARE purchases: the goods arrived. A credit note (negative total) lowers
 * purchases. Non-food and beverage lines are out (not food cost). Credits: only
 * goods-line overcharges (CREDIT_TYPES) whose credit was RECEIVED (resolved) in
 * the period reduce the food cost; accepted claims (the credit to ask for) are
 * shown as "זיכוי לקבל" only.
 */
export async function purchasesInPeriod(
  db: Database,
  restaurantId: string,
  tz: string,
  fromYmd: string,
  toYmd: string,
): Promise<Purchases> {
  const localDate = (ts: SQL) => sql`(${ts} at time zone ${tz})::date`;
  const inWindow = (d: SQL) => sql`(${d} > ${fromYmd}::date and ${d} <= ${toYmd}::date)`;
  const types = sql.join(CREDIT_TYPES.map((t) => sql`${t}`), sql`, `);
  // Claims a supplier credits, on lines that are food cost (non-food and beverage lines are already out).
  const claims = (status: string, windowed: boolean) => sql`coalesce((
          select sum(abs(d.delta_amount)) from match_runs mr
          join discrepancies d on d.match_run_id = mr.id and d.restaurant_id = ${restaurantId}
          left join invoice_lines dl on dl.id = d.invoice_line_id
          left join products dp on dp.id = coalesce(dl.product_id, d.product_id) and dp.restaurant_id = ${restaurantId}
          where mr.invoice_id = i.id and mr.restaurant_id = ${restaurantId}
            and ${LEAK_FILTER} and d.resolution_status = ${status}
            and d.type::text in (${types}) and coalesce(d.delta_amount, 0) <> 0
            and not (coalesce(dp.category, '') ~* ${NON_FOOD_PATTERN})
            and not (coalesce(dp.category, '') ~* ${BEVERAGE_PATTERN})
            ${windowed ? sql`and ${inWindow(localDate(sql`coalesce(d.resolved_at, i.invoice_date, i.created_at)`))}` : sql``}
        ), 0)`;
  const lines = (where: SQL) => sql`coalesce((
          select sum(l.line_total) from invoice_lines l
          join products p on p.id = l.product_id and p.restaurant_id = ${restaurantId}
          where l.invoice_id = i.id and ${where}
        ), 0)`;
  const [r] = (await db.execute(sql`
    with inv as (
      select
        i.id,
        ${inWindow(localDate(sql`coalesce(i.invoice_date, i.created_at)`))} as in_period,
        -- no ex-VAT total (an OCR miss): incl − VAT
        coalesce(i.total_excl_vat, i.total_incl_vat - i.vat_amount) as excl,
        exists (
          select 1 from match_runs mr
          join discrepancies d on d.match_run_id = mr.id and d.restaurant_id = ${restaurantId}
          where mr.invoice_id = i.id and mr.restaurant_id = ${restaurantId} and ${LIVE_DUPLICATE}
        ) as dup,
        ${lines(sql`coalesce(p.category, '') ~* ${NON_FOOD_PATTERN}`)} as non_food,
        ${lines(sql`coalesce(p.category, '') ~* ${BEVERAGE_PATTERN} and not (coalesce(p.category, '') ~* ${NON_FOOD_PATTERN})`)} as bev,
        ${claims('resolved', true)} as received,
        ${claims('accepted', false)} as to_receive
      from invoices i
      where i.restaurant_id = ${restaurantId}
    ),
    t as (select *, coalesce(excl, 0) as total from inv where not dup),
    -- Lines out of food cost are capped at the invoice total, with its sign (a credit note's lines are negative).
    nf as (
      select *, case when total >= 0 then least(greatest(non_food, 0), total) else greatest(least(non_food, 0), total) end as nf_c from t
    ),
    f as (
      select *,
        case when total >= 0 then least(greatest(bev, 0), total - nf_c) else greatest(least(bev, 0), total - nf_c) end as bev_c
      from nf
    ),
    food as (select *, total - nf_c - bev_c as food from f)
    select
      (select count(*) from food where in_period)::int as n,
      (select coalesce(sum(total), 0) from food where in_period)::numeric(14,2)::text as total,
      (select coalesce(sum(nf_c), 0) from food where in_period)::numeric(14,2)::text as non_food,
      (select coalesce(sum(bev_c), 0) from food where in_period)::numeric(14,2)::text as bev,
      (select count(*) from food where in_period and excl is null)::int as missing_n,
      (select count(*) from inv where dup and in_period)::int as dup_n,
      (select coalesce(sum(excl), 0) from inv where dup and in_period)::numeric(14,2)::text as dup_total,
      -- a credit can't exceed what the invoice's food cost was (a credit note has none to credit)
      (select coalesce(sum(least(received, greatest(food, 0))), 0) from food)::numeric(14,2)::text as received,
      (select coalesce(sum(least(to_receive, greatest(food, 0))), 0) from food where in_period)::numeric(14,2)::text as to_receive
  `)) as unknown as Array<{
    n: number;
    total: string;
    non_food: string;
    bev: string;
    missing_n: number;
    dup_n: number;
    dup_total: string;
    received: string;
    to_receive: string;
  }>;
  const invoicesAgorot = agorot(r?.total);
  const nonFoodAgorot = agorot(r?.non_food);
  const beverageAgorot = agorot(r?.bev);
  const notes = await deliveryNoteAccruals(db, restaurantId, tz, fromYmd, toYmd);
  return {
    purchasesAgorot: invoicesAgorot - nonFoodAgorot - beverageAgorot + notes.accruedAgorot - notes.reversedAgorot,
    invoiceCount: Number(r?.n ?? 0),
    invoicesAgorot,
    nonFoodAgorot,
    beverageAgorot,
    missingTotalCount: Number(r?.missing_n ?? 0),
    duplicatesAgorot: agorot(r?.dup_total),
    duplicateCount: Number(r?.dup_n ?? 0),
    creditsAgorot: agorot(r?.received),
    creditsToReceiveAgorot: agorot(r?.to_receive),
    ...notes,
  };
}

/**
 * Receipt-date accrual for delivery notes (תעודות משלוח: goods receipts tagged
 * `ת.מ. <n>`, no invoice of their own, billed later on a consolidated invoice
 * that lists them in ocr_payload.raw.deliveryNotes). A note received in the
 * period that no invoice dated by the closing date covers yet is ADDED at its
 * PO prices (food lines, received − rejected, ex-VAT); when a consolidated
 * invoice in the period covers notes received before the period (already added
 * then), that same value is TAKEN BACK. One valuation both ways, so across
 * consecutive periods every note counts exactly once. A note is covered only by
 * an invoice of ITS supplier, on a number normalised like invoice numbers.
 */
export async function deliveryNoteAccruals(
  db: Database,
  restaurantId: string,
  tz: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ accruedAgorot: number; accruedNotes: number; reversedAgorot: number }> {
  // A note number is matched like an invoice number: a "ת.מ." / ת"מ prefix dropped, letters/digits only,
  // upper-case, no leading zeros ("ת.מ. 007702" = "7702").
  const norm = (col: SQL) =>
    sql`nullif(regexp_replace(regexp_replace(regexp_replace(upper(${col}), '^\s*ת\s*[.״"׳'']?\s*מ\s*[.״"׳'']?\s*', ''), '[^[:alnum:]]', '', 'g'), '^0+', ''), '')`;
  const [r] = (await db.execute(sql`
    with notes as (
      select
        gr.id,
        po.supplier_id,
        (gr.received_at at time zone ${tz})::date as d,
        ${norm(sql`substring(gr.notes from '^ת\\.מ\\.\\s*(\\S+)')`)} as dn,
        coalesce(sum((gl.qty_received - coalesce(gl.qty_rejected, 0)) * pl.unit_price_expected)
          filter (where not (coalesce(p.category, '') ~* ${NON_FOOD_PATTERN}) and not (coalesce(p.category, '') ~* ${BEVERAGE_PATTERN})), 0) as val
      from goods_receipts gr
      join purchase_orders po on po.id = gr.po_id and po.restaurant_id = ${restaurantId}
      join gr_lines gl on gl.gr_id = gr.id
      join po_lines pl on pl.id = gl.po_line_id
      left join products p on p.id = coalesce(gl.product_id, pl.product_id) and p.restaurant_id = ${restaurantId}
      where gr.restaurant_id = ${restaurantId}
        and gr.notes ~ '^ת\\.מ\\.'
        and not exists (select 1 from match_runs mr where mr.gr_id = gr.id and mr.restaurant_id = ${restaurantId} and mr.invoice_id is not null)
      group by gr.id, po.supplier_id, gr.received_at, gr.notes
    ),
    covered as (
      select
        i.supplier_id,
        ${norm(sql`case when jsonb_typeof(n) = 'object' then n ->> 'number' else n #>> '{}' end`)} as dn,
        (coalesce(i.invoice_date, i.created_at) at time zone ${tz})::date as idate
      from invoices i
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(i.ocr_payload -> 'raw' -> 'deliveryNotes') = 'array' then i.ocr_payload -> 'raw' -> 'deliveryNotes' else '[]'::jsonb end
      ) n
      where i.restaurant_id = ${restaurantId}
    ),
    -- A consolidated invoice whose supplier is not linked yet (OCR) covers the listed number for whichever
    -- supplier's note carries it (the notes' supplier is the fallback).
    marked as (
      select notes.*,
        exists (select 1 from covered c where c.dn = notes.dn and (c.supplier_id = notes.supplier_id or c.supplier_id is null) and c.idate <= ${toYmd}::date) as billed_by_close,
        exists (select 1 from covered c where c.dn = notes.dn and (c.supplier_id = notes.supplier_id or c.supplier_id is null) and c.idate <= ${fromYmd}::date) as billed_by_open,
        exists (select 1 from covered c where c.dn = notes.dn and (c.supplier_id = notes.supplier_id or c.supplier_id is null) and c.idate > ${fromYmd}::date and c.idate <= ${toYmd}::date) as billed_in_period
      from notes
      where notes.dn is not null
    )
    select
      coalesce(sum(val) filter (where d > ${fromYmd}::date and d <= ${toYmd}::date and not billed_by_close), 0)::numeric(14,2)::text as accrued,
      count(*) filter (where d > ${fromYmd}::date and d <= ${toYmd}::date and not billed_by_close)::int as accrued_n,
      coalesce(sum(val) filter (where d <= ${fromYmd}::date and billed_in_period and not billed_by_open), 0)::numeric(14,2)::text as reversed
    from marked
  `)) as unknown as Array<{ accrued: string; accrued_n: number; reversed: string }>;
  return { accruedAgorot: agorot(r?.accrued), accruedNotes: Number(r?.accrued_n ?? 0), reversedAgorot: agorot(r?.reversed) };
}

/** A paid price with where it came from (the invoice the price line was read off). */
export interface PricedWithSource extends UnitPrice {
  source: InventoryPriceSource;
}

/**
 * Latest PAID unit price per product on or before local date `ymd` (ex-VAT, per
 * the product's default unit — the recipes engine's price source), with the
 * invoice it came from (number, date, supplier) so the owner recognises it.
 */
export async function pricesWithSourceAsOf(
  db: Database,
  restaurantId: string,
  ymd: string,
  tz: string,
  productIds: string[],
): Promise<Map<string, PricedWithSource>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([priceHistory.productId], {
      productId: priceHistory.productId,
      unitPrice: priceHistory.unitPrice,
      observedAt: priceHistory.observedAt,
      unit: products.defaultUnit,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      supplierName: suppliers.name,
    })
    .from(priceHistory)
    .innerJoin(products, and(eq(products.id, priceHistory.productId), eq(products.restaurantId, restaurantId)))
    .leftJoin(invoices, and(eq(invoices.id, priceHistory.sourceInvoiceId), eq(invoices.restaurantId, restaurantId)))
    .leftJoin(suppliers, and(eq(suppliers.id, priceHistory.supplierId), eq(suppliers.restaurantId, restaurantId)))
    .where(
      and(
        eq(priceHistory.restaurantId, restaurantId),
        lt(priceHistory.observedAt, endOfLocalDate(ymd, tz)),
        inArray(priceHistory.productId, productIds),
      ),
    )
    .orderBy(priceHistory.productId, desc(priceHistory.observedAt), desc(priceHistory.id));
  return new Map(
    rows.map((r) => [
      r.productId,
      {
        unitPrice: r.unitPrice,
        unit: r.unit,
        source: {
          observedAt: r.observedAt.toISOString(),
          invoiceId: r.invoiceId,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate ? localToday(tz, r.invoiceDate) : null,
          supplierName: r.supplierName,
        },
      },
    ]),
  );
}

/**
 * Goods received per product in local dates (fromYmd, toYmd] (received −
 * rejected), in the product's default unit where the PO unit converts. Feeds the
 * sanity check "counted more than last count + received since?".
 */
export async function receivedBetween(
  db: Database,
  restaurantId: string,
  tz: string,
  fromYmd: string,
  toYmd: string,
  productIds: string[],
): Promise<Map<string, Array<{ qty: string; unit: string }>>> {
  if (productIds.length === 0) return new Map();
  const ids = sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await db.execute(sql`
    select coalesce(gl.product_id, pl.product_id) as pid, pl.unit,
           sum(gl.qty_received - coalesce(gl.qty_rejected, 0))::numeric(14,4)::text as qty
    from goods_receipts gr
    join gr_lines gl on gl.gr_id = gr.id
    join po_lines pl on pl.id = gl.po_line_id
    where gr.restaurant_id = ${restaurantId}
      and (gr.received_at at time zone ${tz})::date > ${fromYmd}::date
      and (gr.received_at at time zone ${tz})::date <= ${toYmd}::date
      and coalesce(gl.product_id, pl.product_id) in (${ids})
    group by 1, 2
  `)) as unknown as Array<{ pid: string; unit: string; qty: string }>;
  const out = new Map<string, Array<{ qty: string; unit: string }>>();
  for (const r of rows) out.set(r.pid, [...(out.get(r.pid) ?? []), { qty: r.qty, unit: r.unit }]);
  return out;
}

/** The local month start (YYYY-MM-01) of a local date. */
export function monthStartOf(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** The day before a local date (YYYY-MM-DD), calendar arithmetic. */
export function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
