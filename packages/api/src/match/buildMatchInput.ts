import {
  and,
  asc,
  eq,
  goodsReceipts,
  grLines,
  gte,
  inArray,
  invoiceLines,
  invoices,
  isNull,
  lt,
  lte,
  ne,
  or,
  poLines,
  priceBaselines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  type Database,
} from '@restomatch/db';
import {
  resolveTolerances,
  type BaselineEntry,
  type GrLineInput,
  type InvoiceLineInput,
  type MatchInput,
  type PoLineInput,
} from '@restomatch/matching';
import { addCalendarDaysInTz, endOfDayInTz, startOfDayInTz } from '../lib/time';
import { featureEnabled } from '../lib/features';
import { applyContractPrices } from '../contracts/load';
import { localDateKey } from '../contracts/core';
import { chargeKeyCovers } from '../catalog/linkQuestions';

const DEFAULT_TZ = 'Asia/Jerusalem';

/** PO statuses eligible to be matched against an incoming invoice. */
const ELIGIBLE_PO_STATUSES = ['sent', 'confirmed', 'partial'] as const;
/** ± window (days) around the invoice date in which a PO's expected delivery may fall. */
export const PO_MATCH_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASELINE_WINDOW_DAYS = 90;

export interface BuiltMatchInput {
  input: MatchInput;
  /** Resolved PO / GR for matchRuns.po_id / gr_id provenance (null when none matched). */
  poId: string | null;
  grId: string | null;
}

const num = (v: string | null, fallback = 0): number => (v == null ? fallback : Number(v));

/** Default Israeli VAT used when no rate is configured at any level (18% since 2025-01-01). */
const DEFAULT_VAT_RATE = 0.18;

/** First non-null rate (numeric string) wins; otherwise the default. */
const firstVatRate = (...rates: Array<string | null>): number => {
  for (const r of rates) {
    if (r != null) return Number(r);
  }
  return DEFAULT_VAT_RATE;
};

/**
 * "The PO has a goods receipt". The outer column is spelled out: in a one-table
 * select drizzle renders `${purchaseOrders.id}` unqualified, which inside the
 * subquery would resolve to the receipt's own id.
 */
const receivedSql = (restaurantId: string) =>
  sql<boolean>`EXISTS (SELECT 1 FROM goods_receipts gr WHERE gr.po_id = "purchase_orders"."id" AND gr.restaurant_id = ${restaurantId})`;

interface PoCandidate {
  id: string;
  expectedDeliveryAt: Date | null;
  vatRate: string | null;
  /** The PO has a goods receipt — its goods arrived. */
  received: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assemble a {@link MatchInput} for an invoice by discovering the purchase order
 * it should be checked against. This is the missing link that turns the engine
 * from "invoice-only" into a true 3-way (PO → goods receipt → invoice) match.
 *
 * Runs on the worker's service connection (RLS-bypassing) OR inside a member tx;
 * every query is explicitly scoped by restaurant_id either way. Returns null when
 * the invoice has no lines to match (nothing to do). When no PO is found it still
 * returns an input with empty poLines, so the engine emits UNORDERED_ARRIVAL.
 *
 * `pinnedPoId` (a re-match): the PO the invoice was already matched against. It
 * is used whatever its status — by then it is usually `received`/`closed`, which
 * discovery skips, and re-matching against "no PO" would flag the whole invoice
 * as UNORDERED_ARRIVAL. It is one more discovery candidate (nearest day wins —
 * received first for a photo, and a received pin is never displaced by an
 * undelivered PO — ties to it), dropped when gone, cancelled, of another supplier, or outside the
 * ±PO_MATCH_WINDOW_DAYS window around the invoice date — so after a corrected
 * date or supplier the invoice is free to move to the right PO, and a re-match
 * picks what a fresh match would.
 */
export async function buildMatchInputForInvoice(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  /** skipPoDiscovery: build the invoice side only (lines, VAT, baselines, known numbers) — the consolidated cross-match adds its own multi-PO lines. */
  options: { pinnedPoId?: string | null; skipPoDiscovery?: boolean } = {},
): Promise<BuiltMatchInput | null> {
  const [inv] = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      createdAt: invoices.createdAt,
      totalExclVat: invoices.totalExclVat,
      vatAmount: invoices.vatAmount,
      totalInclVat: invoices.totalInclVat,
      ocrPayload: invoices.ocrPayload,
      source: invoices.source,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv) return null;
  // A consolidated invoice (חשבונית ריכוז, ocr_payload.raw.kind 'consolidated') is never
  // PO-matched, by any path (the worker's match-invoice job, a re-match, a receipt):
  // it has no PO of its own, so discovery could only mark it UNORDERED_ARRIVAL or
  // pin it to one delivery's PO. It is cross-matched against its delivery notes
  // (match/consolidated.ts), which asks for the invoice side only (skipPoDiscovery).
  if (!options.skipPoDiscovery && (inv.ocrPayload?.raw as { kind?: unknown } | null | undefined)?.kind === 'consolidated') {
    return null;
  }
  // A scan whose number another invoice of this supplier already holds is
  // stored WITHOUT it (invoices_dedupe_idx; the worker's writeOcrHeader) and
  // keeps the number in ocr_payload.raw.duplicateOf. Match on that number so
  // the engine still raises DUPLICATE_INVOICE (block) on the copy.
  const heldDuplicate = (
    inv.ocrPayload?.raw as
      | { duplicateOf?: { invoiceId?: unknown; invoiceNumber?: unknown } }
      | null
      | undefined
  )?.duplicateOf;
  const heldDuplicateNumber = heldDuplicate?.invoiceNumber;
  const invoiceNumber =
    inv.invoiceNumber ?? (typeof heldDuplicateNumber === 'string' ? heldDuplicateNumber : null);
  // The invoice that holds the number counts as known even when this copy's
  // row is older (OCR jobs can finish out of order). The holder never sees the
  // copy's number (its invoice_number is NULL), so the original stays unflagged.
  const heldDuplicateOfId =
    typeof heldDuplicate?.invoiceId === 'string' && UUID_RE.test(heldDuplicate.invoiceId)
      ? heldDuplicate.invoiceId
      : null;

  // ── Known invoice numbers for the supplier (duplicate detection). ──
  let knownInvoiceNumbers: Set<string> | undefined;
  if (inv.supplierId) {
    const rows = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          eq(invoices.restaurantId, restaurantId),
          eq(invoices.supplierId, inv.supplierId),
          ne(invoices.id, invoiceId),
          // Only invoices that arrived BEFORE this one: re-matching the original
          // after its duplicate shows up must not flag the original too (the
          // pair would otherwise both be blocked and the total counted twice).
          // Ties (same-batch inserts) break on id so exactly one of a pair flags.
          or(
            lt(invoices.createdAt, inv.createdAt),
            and(eq(invoices.createdAt, inv.createdAt), lt(invoices.id, invoiceId)),
            ...(heldDuplicateOfId ? [eq(invoices.id, heldDuplicateOfId)] : []),
          ),
        ),
      );
    knownInvoiceNumbers = new Set(
      rows.map((r) => normalizeInvoiceNumber(r.invoiceNumber)).filter((n): n is string => !!n),
    );
  }

  // G-08 charge (round 4): a duplicate copy is never charge-filtered — its
  // DUPLICATE_INVOICE ₪ is the whole printed invoice, charges included.
  const normalizedNumber = normalizeInvoiceNumber(invoiceNumber);
  const isDuplicate = !!normalizedNumber && (knownInvoiceNumbers?.has(normalizedNumber) ?? false);

  const invLineRows = await db
    .select({
      id: invoiceLines.id,
      productId: invoiceLines.productId,
      supplierSku: invoiceLines.supplierSku,
      qtyBilled: invoiceLines.qtyBilled,
      unit: invoiceLines.unit,
      unitPriceBilled: invoiceLines.unitPriceBilled,
      lineTotal: invoiceLines.lineTotal,
      vatRate: invoiceLines.vatRate, // G-08 charge
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  if (invLineRows.length === 0) return null;

  // G-08 charge: lines a person answered "שורת חיוב — לא מוצר" (deposit, delivery,
  // discount; ocr_payload.chargeLineIds) are not products — the engine would call
  // them UNORDERED_ITEM. They stay out of the engine input, and the invoice totals
  // passed in are reduced by exactly their amounts (below), so TOTAL / VAT checks
  // stay reconciled. No charge line ⇒ byte-identical input to before.
  const chargeIds = isDuplicate ? new Set<string>() : readChargeLineIds(inv.ocrPayload);
  let chargeRows = invLineRows.filter((l) => chargeIds.has(l.id));
  let productRows = chargeRows.length > 0 ? invLineRows.filter((l) => !chargeIds.has(l.id)) : invLineRows;
  // Round 4: "every line a charge" only when the charges ARE the invoice — a
  // printed subtotal still > 10 agorot away from them is checked like any
  // invoice (all lines, the printed header), never a silent ₪0.
  if (chargeRows.length > 0 && productRows.length === 0 && inv.totalExclVat != null) {
    let netAg = 0;
    for (const l of chargeRows) netAg += Math.round(num(l.lineTotal) * 100);
    if (Math.abs(Math.round(num(inv.totalExclVat) * 100) - netAg) > 10) {
      chargeRows = [];
      productRows = invLineRows;
    }
  }
  // Every line a charge (a deposit-only slip): nothing to compare — matched clean
  // (round 3 LOW). No PO is discovered: an empty engine input yields no finding.
  const allCharge = productRows.length === 0;

  const invoiceLineInputs: InvoiceLineInput[] = productRows.map((l) => ({
    id: l.id,
    productId: l.productId,
    supplierSku: l.supplierSku,
    qtyBilled: num(l.qtyBilled),
    unit: l.unit,
    unitPriceBilled: num(l.unitPriceBilled),
    lineTotal: num(l.lineTotal),
  }));

  const invoiceDate = inv.invoiceDate ?? inv.createdAt;

  // ── Restaurant settings: timezone, tolerances, vat rate, baseline window. ──
  // Loaded up-front because the ±window math below must anchor to the
  // restaurant's LOCAL calendar day, not the server's UTC clock.
  const [restaurant] = await db
    .select({
      settings: restaurants.settings,
      vatRate: restaurants.vatRate,
      timezone: restaurants.timezone,
    })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = restaurant?.timezone ?? DEFAULT_TZ;

  // ── Discover the candidate PO: same supplier, eligible status, expected
  //    delivery within ±window of the invoice date; nearest delivery wins. ──
  let po: PoCandidate | null = null;
  // The PO window: from the start of the local day PO_MATCH_WINDOW_DAYS before
  // the invoice date to the end of the day PO_MATCH_WINDOW_DAYS after it —
  // aligned to the restaurant's calendar (DST-safe) instead of raw getTime() ±
  // 7*DAY, which drifts by the UTC offset near midnight. (Being local-day
  // aligned, it reaches up to ~8×24h each side — so a candidate can be past the
  // engine's 7×24h DATE_ANOMALY threshold; persistMatchRun stores that finding
  // without its epoch-ms values.)
  const lo = startOfDayInTz(addCalendarDaysInTz(invoiceDate, -PO_MATCH_WINDOW_DAYS, tz), tz);
  const hi = endOfDayInTz(addCalendarDaysInTz(invoiceDate, PO_MATCH_WINDOW_DAYS, tz), tz);
  const inWindow = (at: Date | null) => at == null || (at >= lo && at <= hi);
  if (inv.supplierId && !options.skipPoDiscovery && !allCharge) {
    const candidates: PoCandidate[] = [];
    // A re-match's pinned PO is ONE MORE candidate, never a short-circuit: it
    // skips the status filter (by then it is usually closed / received, which
    // discovery skips) but is dropped when cancelled, from another supplier or
    // out of the window. Listed first, so a tie goes to it (pickNearest keeps the
    // first of equals). How candidates rank depends on the invoice's source — below.
    if (options.pinnedPoId) {
      const [pinned] = await db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          status: purchaseOrders.status,
          expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
          vatRate: purchaseOrders.vatRate,
          received: receivedSql(restaurantId),
        })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, options.pinnedPoId), eq(purchaseOrders.restaurantId, restaurantId)))
        .limit(1);
      if (
        pinned &&
        pinned.status !== 'cancelled' &&
        pinned.supplierId === inv.supplierId &&
        inWindow(pinned.expectedDeliveryAt)
      ) {
        candidates.push({
          id: pinned.id,
          expectedDeliveryAt: pinned.expectedDeliveryAt,
          vatRate: pinned.vatRate,
          received: pinned.received,
        });
      }
    }
    const open = await db
      .select({
        id: purchaseOrders.id,
        expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
        vatRate: purchaseOrders.vatRate,
        received: receivedSql(restaurantId),
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.restaurantId, restaurantId),
          eq(purchaseOrders.supplierId, inv.supplierId),
          inArray(purchaseOrders.status, [...ELIGIBLE_PO_STATUSES]),
          // A null expected_delivery_at shouldn't exclude a candidate (it may
          // still be the right PO); treat null as "passes the bound".
          or(isNull(purchaseOrders.expectedDeliveryAt), gte(purchaseOrders.expectedDeliveryAt, lo)),
          or(isNull(purchaseOrders.expectedDeliveryAt), lte(purchaseOrders.expectedDeliveryAt, hi)),
        ),
      )
      .orderBy(asc(purchaseOrders.expectedDeliveryAt));
    for (const c of open) if (!candidates.some((x) => x.id === c.id)) candidates.push(c);
    // A photo is taken in the receiving wizard, so its own PO has a receipt — rank
    // received first. An emailed / platform / manual invoice often arrives before
    // the goods (Thursday's invoice emailed Thursday morning), so it goes by the
    // nearest day — except that a pinned PO with a receipt is never displaced by one
    // without (the next standing order must not take a received invoice away).
    const pinned = options.pinnedPoId ? candidates.find((c) => c.id === options.pinnedPoId) : undefined;
    po =
      inv.source === 'photo'
        ? pickNearest(candidates, invoiceDate, tz, { receivedFirst: true })
        : pickNearest(pinned?.received ? candidates.filter((c) => c.received) : candidates, invoiceDate, tz, {
            receivedFirst: false,
          });
  }

  let poLineInputs: PoLineInput[] = [];
  let grLineInputs: GrLineInput[] = [];
  let grId: string | null = null;
  if (po) {
    const poLineRows = await db
      .select({
        id: poLines.id,
        productId: poLines.productId,
        supplierSku: poLines.supplierSku,
        qtyOrdered: poLines.qtyOrdered,
        unit: poLines.unit,
        unitPriceExpected: poLines.unitPriceExpected,
        // G-08 charge (round 4 HIGH): an order line a learned charge key covers
        // ("משלוח") is not a product — it could never pair and would read MISSING.
        charge: inv.supplierId
          ? sql<boolean>`("po_lines"."product_id" is null and ${chargeKeyCovers(
              restaurantId,
              sql`${inv.supplierId}::uuid`,
              sql.raw('"po_lines"."supplier_sku"'),
              sql.raw('"po_lines"."raw_description"'),
            )})`
          : sql<boolean>`false`,
        // …and a blank name-only order line is never a question nor a product (round 4).
        blank: sql<boolean>`("po_lines"."product_id" is null and "po_lines"."supplier_sku" is null and coalesce(btrim("po_lines"."raw_description"), '') = '')`,
      })
      .from(poLines)
      .where(eq(poLines.poId, po.id));
    poLineInputs = poLineRows.filter((p) => p.charge !== true && p.blank !== true).map((p) => ({
      id: p.id,
      productId: p.productId,
      supplierSku: p.supplierSku,
      qtyOrdered: num(p.qtyOrdered),
      unit: p.unit,
      unitPriceExpected: p.unitPriceExpected == null ? null : Number(p.unitPriceExpected),
    }));

    const grs = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.poId, po.id), eq(goodsReceipts.restaurantId, restaurantId)))
      .orderBy(asc(goodsReceipts.receivedAt));
    const grIds = grs.map((g) => g.id);
    grId = grIds.length > 0 ? grIds[grIds.length - 1]! : null;
    if (grIds.length > 0) {
      const grLineRows = await db
        .select({
          id: grLines.id,
          poLineId: grLines.poLineId,
          productId: grLines.productId,
          qtyReceived: grLines.qtyReceived,
        })
        .from(grLines)
        .where(inArray(grLines.grId, grIds));
      grLineInputs = grLineRows.map((g) => ({
        id: g.id,
        poLineId: g.poLineId,
        productId: g.productId,
        qtyReceived: num(g.qtyReceived),
      }));
    }
  }

  // ── Contract prices (wave-1 `contracts`): the contract in force on the
  //    invoice's LOCAL date beats the PO price as the expected unit price, so an
  //    over-contract line is a PRICE_HIGHER against the contract. Feature-gated;
  //    off ⇒ byte-identical input to before. See contracts/core.ts for the rule.
  if (inv.supplierId && poLineInputs.length > 0 && featureEnabled(restaurant?.settings, 'contracts')) {
    ({ poLines: poLineInputs } = await applyContractPrices(
      db,
      restaurantId,
      inv.supplierId,
      poLineInputs,
      localDateKey(invoiceDate, tz),
    ));
  }

  // ── Tolerances, vat rate, baseline window (restaurant loaded above). ──
  const tolerances = resolveTolerances(restaurant?.settings?.tolerances);

  // VAT rate precedence: PO override → supplier override → restaurant default →
  // the 18% default. A supplier billing at a non-default rate (e.g. a 17%
  // legacy invoice or a VAT-exempt Eilat supplier) would otherwise false-fire
  // VAT_MISMATCH against the restaurant default.
  let supplierVatRate: string | null = null;
  if (inv.supplierId) {
    const [sup] = await db
      .select({ vatRate: suppliers.vatRate })
      .from(suppliers)
      .where(and(eq(suppliers.id, inv.supplierId), eq(suppliers.restaurantId, restaurantId)))
      .limit(1);
    supplierVatRate = sup?.vatRate ?? null;
  }
  const vatRate = firstVatRate(po?.vatRate ?? null, supplierVatRate, restaurant?.vatRate ?? null);
  const baselineWindow = restaurant?.settings?.baselineWindowDays ?? DEFAULT_BASELINE_WINDOW_DAYS;

  // ── Price baselines per product (supplier-specific preferred over global). ──
  const productIds = [
    ...new Set(
      [...poLineInputs, ...invoiceLineInputs]
        .map((l) => l.productId)
        .filter((id): id is string => !!id),
    ),
  ];
  let baselines: Record<string, BaselineEntry> | undefined;
  if (productIds.length > 0) {
    const supplierFilter = inv.supplierId
      ? or(eq(priceBaselines.supplierId, inv.supplierId), isNull(priceBaselines.supplierId))
      : isNull(priceBaselines.supplierId);
    const rows = await db
      .select({
        productId: priceBaselines.productId,
        supplierId: priceBaselines.supplierId,
        p50: priceBaselines.p50,
        p90: priceBaselines.p90,
      })
      .from(priceBaselines)
      .where(
        and(
          eq(priceBaselines.restaurantId, restaurantId),
          inArray(priceBaselines.productId, productIds),
          eq(priceBaselines.windowDays, baselineWindow),
          supplierFilter,
        ),
      );
    const acc: Record<string, BaselineEntry> = {};
    for (const r of rows) {
      if (r.p50 == null || r.p90 == null) continue;
      const supplierSpecific = r.supplierId != null;
      // Supplier-specific baseline wins over the global (null-supplier) one.
      if (!(r.productId in acc) || supplierSpecific) {
        acc[r.productId] = { p50: Number(r.p50), p90: Number(r.p90) };
      }
    }
    if (Object.keys(acc).length > 0) baselines = acc;
  }

  // G-08 charge: take the charge lines' net and VAT (each line's own vat_rate,
  // e.g. 0 for a deposit; else the invoice rate) out of the totals, in integer
  // agorot, half-up per line.
  let totalExclVat = num(inv.totalExclVat);
  let vatAmount = num(inv.vatAmount);
  let totalInclVat = num(inv.totalInclVat);
  // Only from a total the supplier printed (round 3 LOW): a NULL header total
  // stays 0 rather than turning negative.
  if (chargeRows.length > 0) {
    let netAg = 0;
    let vatAg = 0;
    for (const l of chargeRows) {
      const lineAg = Math.round(num(l.lineTotal) * 100);
      netAg += lineAg;
      vatAg += Math.sign(lineAg) * Math.round(Math.abs(lineAg) * (l.vatRate == null ? vatRate : Number(l.vatRate)));
    }
    if (inv.totalExclVat != null) totalExclVat = (Math.round(totalExclVat * 100) - netAg) / 100;
    if (inv.vatAmount != null) vatAmount = (Math.round(vatAmount * 100) - vatAg) / 100;
    if (inv.totalInclVat != null) totalInclVat = (Math.round(totalInclVat * 100) - netAg - vatAg) / 100;
  }

  const input: MatchInput = {
    invoice: {
      // Normalized (see normalizeInvoiceNumber) — the engine only uses it for
      // duplicate detection + its message, and compares it to the known set.
      invoiceNumber: normalizedNumber ?? '',
      invoiceDate,
      supplierId: inv.supplierId ?? '',
      totalExclVat,
      vatAmount,
      totalInclVat,
    },
    poLines: poLineInputs,
    grLines: grLineInputs,
    invoiceLines: invoiceLineInputs,
    vatRate,
    tolerances,
    ...(baselines ? { baselines } : {}),
    ...(knownInvoiceNumbers ? { knownInvoiceNumbers } : {}),
    ...(po?.expectedDeliveryAt ? { expectedDeliveryDate: po.expectedDeliveryAt } : {}),
  };

  return { input, poId: po?.id ?? null, grId };
}

/** G-08 charge: the invoice-line ids marked "שורת חיוב — לא מוצר" (ocr_payload.chargeLineIds). */
export function readChargeLineIds(payload: unknown): Set<string> {
  const ids = (payload as { chargeLineIds?: unknown } | null | undefined)?.chargeLineIds;
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
}

/**
 * Canonical form of an invoice number for duplicate detection. The DB already
 * rejects an exact (supplier, invoice_number) repeat, so a real double-bill
 * arrives with formatting differences — "INV-0012", "inv 12", "12/". Keep only
 * letters/digits, upper-case, and drop leading zeros of each digit run.
 */
export function normalizeInvoiceNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  const canon = compact.replace(/(^|\D)0+(?=\d)/g, '$1');
  return canon.length > 0 ? canon : null;
}

/**
 * Pick the PO whose expectedDeliveryAt falls on the LOCAL calendar day closest
 * to the invoice's local day (nulls last). Comparing whole local days — rather
 * than raw ms — means a PO due "the same day" as the invoice wins regardless of
 * the time-of-day the timestamps happen to carry, and the result doesn't drift
 * by the UTC offset near midnight. With `receivedFirst`, a PO whose goods were
 * received (it has a goods receipt) beats one not yet delivered before the day
 * counts. A tie keeps the earlier candidate (the pin is listed first).
 */
function pickNearest(
  candidates: PoCandidate[],
  invoiceDate: Date,
  tz: string,
  opts: { receivedFirst: boolean },
): PoCandidate | null {
  if (candidates.length === 0) return null;
  const invDayStart = startOfDayInTz(invoiceDate, tz);
  let best = candidates[0]!;
  let bestDelta = dayDelta(best.expectedDeliveryAt, invDayStart, tz);
  for (const c of candidates.slice(1)) {
    const d = dayDelta(c.expectedDeliveryAt, invDayStart, tz);
    const better = opts.receivedFirst
      ? (c.received && !best.received) || (c.received === best.received && d < bestDelta)
      : d < bestDelta;
    if (better) {
      best = c;
      bestDelta = d;
    }
  }
  return best;
}

/**
 * Absolute number of LOCAL calendar days between a candidate's expected
 * delivery and the (already-local-day-aligned) invoice day. Nulls sort last.
 */
const dayDelta = (d: Date | null, invDayStart: Date, tz: string): number => {
  if (d == null) return Number.POSITIVE_INFINITY;
  const candDayStart = startOfDayInTz(d, tz);
  return Math.abs(candDayStart.getTime() - invDayStart.getTime()) / DAY_MS;
};
