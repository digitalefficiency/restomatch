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
  /** Live duplicate copies left out — their goods are on the original (agorot, count). */
  duplicatesAgorot: number;
  duplicateCount: number;
  /** "זיכויים שהתקבלו": claims on food lines whose credit was RECEIVED (resolved), capped per invoice (agorot). */
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
 * consolidated invoice (חשבונית מרכזת) for a month's delivery notes arrives the
 * month after.
 *
 * Rules shared with the leak engine (@restomatch/charts): an invoice carrying
 * a LIVE duplicate finding is a second bill for goods already counted on the
 * original, so it is left out (a duplicate the bookkeeper rejected — "not a
 * duplicate" — is a normal purchase again). Invoices still waiting for a PO
 * link ARE purchases: the goods arrived. Credits: only claims whose credit was
 * RECEIVED (resolution 'resolved') reduce the food cost; accepted claims
 * ('accepted' — the credit to ask for) are shown as "זיכוי לקבל" only.
 */
export async function purchasesInPeriod(
  db: Database,
  restaurantId: string,
  tz: string,
  fromYmd: string,
  toYmd: string,
): Promise<Purchases> {
  const claimOnFood = (statuses: SQL) => sql`coalesce((
          select sum(abs(d.delta_amount)) from match_runs mr
          join discrepancies d on d.match_run_id = mr.id and d.restaurant_id = ${restaurantId}
          left join invoice_lines dl on dl.id = d.invoice_line_id
          left join products dp on dp.id = coalesce(dl.product_id, d.product_id) and dp.restaurant_id = ${restaurantId}
          where mr.invoice_id = i.id and mr.restaurant_id = ${restaurantId}
            and ${LEAK_FILTER} and d.resolution_status in (${statuses})
            -- a claim on a non-food line: that line is already out of food purchases
            and not (coalesce(dp.category, '') ~* ${NON_FOOD_PATTERN})
        ), 0)`;
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
          where l.invoice_id = i.id and coalesce(p.category, '') ~* ${NON_FOOD_PATTERN}
        ), 0) as non_food,
        ${claimOnFood(sql`'resolved'`)} as received,
        ${claimOnFood(sql`'accepted'`)} as to_receive
      from invoices i
      where i.restaurant_id = ${restaurantId}
        and (coalesce(i.invoice_date, i.created_at) at time zone ${tz})::date > ${fromYmd}::date
        and (coalesce(i.invoice_date, i.created_at) at time zone ${tz})::date <= ${toYmd}::date
    ),
    capped as (
      select *, greatest(total_excl - least(non_food, total_excl), 0) as food from inv where not dup
    )
    select
      (select count(*) from capped)::int as n,
      (select coalesce(sum(total_excl), 0) from capped)::numeric(14,2)::text as total,
      (select coalesce(sum(least(non_food, total_excl)), 0) from capped)::numeric(14,2)::text as non_food,
      (select count(*) from inv where dup)::int as dup_n,
      (select coalesce(sum(total_excl), 0) from inv where dup)::numeric(14,2)::text as dup_total,
      (select coalesce(sum(least(received, food)), 0) from capped)::numeric(14,2)::text as received,
      (select coalesce(sum(least(to_receive, greatest(food - least(received, food), 0))), 0) from capped)::numeric(14,2)::text as to_receive
  `)) as unknown as Array<{ n: number; total: string; non_food: string; dup_n: number; dup_total: string; received: string; to_receive: string }>;
  const invoicesAgorot = agorot(r?.total);
  const nonFoodAgorot = agorot(r?.non_food);
  const notes = await deliveryNoteAccruals(db, restaurantId, tz, fromYmd, toYmd);
  return {
    purchasesAgorot: invoicesAgorot - nonFoodAgorot + notes.accruedAgorot - notes.reversedAgorot,
    invoiceCount: Number(r?.n ?? 0),
    invoicesAgorot,
    nonFoodAgorot,
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
  // A note number is matched like an invoice number: letters/digits only, upper-case, no leading zeros.
  const norm = (col: SQL) => sql`nullif(regexp_replace(regexp_replace(upper(${col}), '[^[:alnum:]]', '', 'g'), '^0+', ''), '')`;
  const [r] = (await db.execute(sql`
    with notes as (
      select
        gr.id,
        po.supplier_id,
        (gr.received_at at time zone ${tz})::date as d,
        ${norm(sql`substring(gr.notes from '^ת\\.מ\\.\\s*(\\S+)')`)} as dn,
        coalesce(sum((gl.qty_received - coalesce(gl.qty_rejected, 0)) * pl.unit_price_expected)
          filter (where not (coalesce(p.category, '') ~* ${NON_FOOD_PATTERN})), 0) as val
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
    marked as (
      select notes.*,
        exists (select 1 from covered c where c.dn = notes.dn and c.supplier_id = notes.supplier_id and c.idate <= ${toYmd}::date) as billed_by_close,
        exists (select 1 from covered c where c.dn = notes.dn and c.supplier_id = notes.supplier_id and c.idate <= ${fromYmd}::date) as billed_by_open,
        exists (select 1 from covered c where c.dn = notes.dn and c.supplier_id = notes.supplier_id and c.idate > ${fromYmd}::date and c.idate <= ${toYmd}::date) as billed_in_period
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
