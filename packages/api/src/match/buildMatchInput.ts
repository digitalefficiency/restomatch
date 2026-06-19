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
  lte,
  ne,
  or,
  poLines,
  priceBaselines,
  purchaseOrders,
  restaurants,
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

/** PO statuses eligible to be matched against an incoming invoice. */
const ELIGIBLE_PO_STATUSES = ['sent', 'confirmed', 'partial'] as const;
/** ± window (days) around the invoice date in which a PO's expected delivery may fall. */
const PO_MATCH_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASELINE_WINDOW_DAYS = 90;

export interface BuiltMatchInput {
  input: MatchInput;
  /** Resolved PO / GR for matchRuns.po_id / gr_id provenance (null when none matched). */
  poId: string | null;
  grId: string | null;
}

const num = (v: string | null, fallback = 0): number => (v == null ? fallback : Number(v));

/** Default Israeli VAT used when no rate is configured at any level. */
const DEFAULT_VAT_RATE = 0.17;

/** First non-null rate (numeric string) wins; otherwise the default. */
const firstVatRate = (...rates: Array<string | null>): number => {
  for (const r of rates) {
    if (r != null) return Number(r);
  }
  return DEFAULT_VAT_RATE;
};

interface PoCandidate {
  id: string;
  expectedDeliveryAt: Date | null;
  vatRate: string | null;
}

/**
 * Assemble a {@link MatchInput} for an invoice by discovering the purchase order
 * it should be checked against. This is the missing link that turns the engine
 * from "invoice-only" into a true 3-way (PO → goods receipt → invoice) match.
 *
 * Runs on the worker's service connection (RLS-bypassing) OR inside a member tx;
 * every query is explicitly scoped by restaurant_id either way. Returns null when
 * the invoice has no lines to match (nothing to do). When no PO is found it still
 * returns an input with empty poLines, so the engine emits UNORDERED_ARRIVAL.
 */
export async function buildMatchInputForInvoice(
  db: Database,
  restaurantId: string,
  invoiceId: string,
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
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv) return null;

  const invLineRows = await db
    .select({
      id: invoiceLines.id,
      productId: invoiceLines.productId,
      qtyBilled: invoiceLines.qtyBilled,
      unit: invoiceLines.unit,
      unitPriceBilled: invoiceLines.unitPriceBilled,
      lineTotal: invoiceLines.lineTotal,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  if (invLineRows.length === 0) return null;

  const invoiceLineInputs: InvoiceLineInput[] = invLineRows.map((l) => ({
    id: l.id,
    productId: l.productId,
    qtyBilled: num(l.qtyBilled),
    unit: l.unit,
    unitPriceBilled: num(l.unitPriceBilled),
    lineTotal: num(l.lineTotal),
  }));

  const invoiceDate = inv.invoiceDate ?? inv.createdAt;

  // ── Discover the candidate PO: same supplier, eligible status, expected
  //    delivery within ±window of the invoice date; nearest delivery wins. ──
  let po: PoCandidate | null = null;
  if (inv.supplierId) {
    const lo = new Date(invoiceDate.getTime() - PO_MATCH_WINDOW_DAYS * DAY_MS);
    const hi = new Date(invoiceDate.getTime() + PO_MATCH_WINDOW_DAYS * DAY_MS);
    const candidates = await db
      .select({
        id: purchaseOrders.id,
        expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
        vatRate: purchaseOrders.vatRate,
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
    po = pickNearest(candidates, invoiceDate);
  }

  let poLineInputs: PoLineInput[] = [];
  let grLineInputs: GrLineInput[] = [];
  let grId: string | null = null;
  if (po) {
    const poLineRows = await db
      .select({
        id: poLines.id,
        productId: poLines.productId,
        qtyOrdered: poLines.qtyOrdered,
        unit: poLines.unit,
        unitPriceExpected: poLines.unitPriceExpected,
      })
      .from(poLines)
      .where(eq(poLines.poId, po.id));
    poLineInputs = poLineRows.map((p) => ({
      id: p.id,
      productId: p.productId,
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

  // ── Restaurant settings: tolerances, vat rate, baseline window. ──
  const [restaurant] = await db
    .select({ settings: restaurants.settings, vatRate: restaurants.vatRate })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tolerances = resolveTolerances(restaurant?.settings?.tolerances);

  // VAT rate precedence: PO override → supplier override → restaurant default →
  // 0.17. A supplier billing at a non-default rate (e.g. Zestt's 18%) would
  // otherwise false-fire VAT_MISMATCH against the 17% restaurant default.
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
        ),
      );
    knownInvoiceNumbers = new Set(
      rows.map((r) => r.invoiceNumber).filter((n): n is string => !!n),
    );
  }

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

  const input: MatchInput = {
    invoice: {
      invoiceNumber: inv.invoiceNumber ?? '',
      invoiceDate,
      supplierId: inv.supplierId ?? '',
      totalExclVat: num(inv.totalExclVat),
      vatAmount: num(inv.vatAmount),
      totalInclVat: num(inv.totalInclVat),
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

/** Pick the PO whose expectedDeliveryAt is closest to the invoice date (nulls last). */
function pickNearest(
  candidates: PoCandidate[],
  invoiceDate: Date,
): PoCandidate | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestDelta = deltaMs(best.expectedDeliveryAt, invoiceDate);
  for (const c of candidates.slice(1)) {
    const d = deltaMs(c.expectedDeliveryAt, invoiceDate);
    if (d < bestDelta) {
      best = c;
      bestDelta = d;
    }
  }
  return best;
}

const deltaMs = (d: Date | null, ref: Date): number =>
  d == null ? Number.POSITIVE_INFINITY : Math.abs(d.getTime() - ref.getTime());
