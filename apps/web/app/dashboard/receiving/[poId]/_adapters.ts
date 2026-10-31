/**
 * Adapters: map the real tRPC outputs (receiving.getPo + getReceipt + getInvoice)
 * into the *presentational* prop shapes the reused showcase _steps expect
 * (ReconciliationResult / ReconciliationLine / LineMark), plus the extra
 * server-side handles the wizard needs to drive real mutations (grLineId per
 * line) which the showcase shapes don't carry.
 *
 * The showcase shapes live in app/showcase/receiver/_mock.ts and _state.ts and
 * are intentionally UI-only — we never mutate them, we just project onto them.
 */

import type {
  LineStatus,
  ReconciliationLine,
  ReconciliationResult,
} from '@/app/showcase/receiver/_mock';
import { lineKey, type LineMark } from '@/app/showcase/receiver/_state';
import { UNCOUNTED, fromGrLine, stripMethod, toGrLine, type GrLineFields, type LineCount } from './_count';

// ── Source row shapes (mirrors of the tRPC outputs; numerics arrive as strings).
export interface PoHeader {
  id: string;
  supplierId: string;
  supplierName: string;
  expectedAt: string | Date | null;
  status: string;
  totalEstimated: string | number | null;
}
export interface PoLineRow {
  id: string;
  productId: string | null;
  rawDescription: string | null;
  /** "Receiver in English" (po_lines.raw_description_en / products.name_en). */
  rawDescriptionEn?: string | null;
  productNameEn?: string | null;
  qtyOrdered: string | number;
  unit: string;
  unitPriceExpected: string | number | null;
}
export interface ReceiptLineRow {
  grLineId: string;
  poLineId: string | null;
  productId: string | null;
  productName: string | null;
  productNameEn?: string | null;
  rawDescription: string | null;
  orderedQty: string | number | null;
  unit: string | null;
  qtyReceived: string | number | null;
  qtyRejected: string | number | null;
  /** 'missing' / 'damaged' — what the Delivery Check recorded (getReceipt). */
  rejectReason?: string | null;
  conditionNotes?: string | null;
}
export interface InvoiceLineRow {
  id: string;
  productId: string | null;
  rawDescription: string | null;
  rawDescriptionEn?: string | null;
  productNameEn?: string | null;
  qtyBilled: string | number | null;
  unit: string | null;
  unitPriceBilled: string | number | null;
  lineTotal: string | number | null;
}
export interface InvoiceMeta {
  invoiceNumber: string | null;
  ocrConfidence: string | number | null;
}

/** Description key for pairing: no quote marks / niqqud, collapsed spaces. */
function normDesc(v: string | null | undefined): string {
  return (v ?? '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/["'\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Derive a line status by comparing PO vs invoice qty/price (UI hint only — the
 *  authoritative reconciliation runs in the matching core server-side). */
function deriveStatus(
  poQty: number | null,
  invoiceQty: number | null,
  poPrice: number | null,
  invoicePrice: number | null,
): { status: LineStatus; deltaIls: number } {
  if (poQty !== null && invoiceQty === null) {
    return { status: 'missing_from_invoice', deltaIls: 0 };
  }
  if (poQty === null && invoiceQty !== null) {
    return { status: 'unordered', deltaIls: (invoiceQty ?? 0) * (invoicePrice ?? 0) };
  }
  if (poPrice !== null && invoicePrice !== null && Math.abs(invoicePrice - poPrice) > 0.001) {
    return { status: 'price_diff', deltaIls: (invoicePrice - poPrice) * (invoiceQty ?? poQty ?? 0) };
  }
  if (poQty !== null && invoiceQty !== null && Math.abs(invoiceQty - poQty) > 0.001) {
    return { status: 'qty_diff', deltaIls: Math.abs(poQty - invoiceQty) * (poPrice ?? invoicePrice ?? 0) };
  }
  return { status: 'matched', deltaIls: 0 };
}

/**
 * An invoice line whose qty or price reads as 0/absent was not really read
 * (EN-3 zero-fills unreadable numbers at low confidence). It is a "check by
 * hand" line, never a ₪ gap.
 */
function isUnreadable(qty: number | null, price: number | null): boolean {
  return qty === null || qty === 0 || price === null || price === 0;
}

/** One logical line from several invoice lines for the same item: summed qty
 *  and total; the unit price is the total over the qty (equal prices stay exact). */
function foldInvoiceLines(group: InvoiceLineRow[]): InvoiceLineRow {
  const first = group[0]!;
  let qty = 0;
  let total = 0;
  const prices = new Set<number | null>();
  for (const il of group) {
    const q = num(il.qtyBilled) ?? 0;
    const p = num(il.unitPriceBilled);
    qty += q;
    total += num(il.lineTotal) ?? q * (p ?? 0);
    prices.add(p);
  }
  const single = prices.size === 1 ? [...prices][0]! : null;
  return {
    ...first,
    qtyBilled: Math.round(qty * 1000) / 1000,
    unitPriceBilled: single ?? (qty > 0 ? Math.round((total / qty) * 10000) / 10000 : null),
    lineTotal: Math.round(total * 100) / 100,
  };
}

export interface ReceivingAdaptResult {
  result: ReconciliationResult;
  /** grLineId keyed by the same lineKey() the reused steps use, so the wizard
   *  can call markGrLine for the line the user just touched. */
  grLineIdByKey: Record<string, string>;
  /** Initial marks pre-seeded from gr_lines (so re-opening a receipt restores
   *  what was already received). */
  initialMarks: Record<string, LineMark>;
}

/**
 * Build the reconciliation projection. `invoiceLines` may be empty (before OCR /
 * when OCR failed or timed out) — then every PO line is "pending review" (the
 * receiver confirms what arrived), never "missing on invoice".
 */
export function adaptReconciliation(args: {
  po: PoHeader;
  poLines: PoLineRow[];
  receiptLines: ReceiptLineRow[];
  invoiceLines?: InvoiceLineRow[];
  invoiceMeta?: InvoiceMeta | null;
  /** Localized fallbacks for nameless lines. */
  labels?: { unnamed: string; unordered: string };
}): ReceivingAdaptResult {
  const { po, poLines, receiptLines, invoiceLines = [], invoiceMeta } = args;
  const labels = args.labels ?? { unnamed: 'פריט ללא שם', unordered: 'פריט שלא הוזמן' };

  // grLineId + recorded qty lookup keyed by poLineId.
  const grByPoLine = new Map<string, ReceiptLineRow>();
  for (const r of receiptLines) {
    if (r.poLineId) grByPoLine.set(r.poLineId, r);
  }

  // Best-effort invoice line lookup by productId, then by (normalized) raw
  // description. Each invoice line pairs with at most one PO line.
  const invByProduct = new Map<string, InvoiceLineRow>();
  const invByDesc = new Map<string, InvoiceLineRow>();
  for (const il of invoiceLines) {
    if (il.productId && !invByProduct.has(il.productId)) invByProduct.set(il.productId, il);
    const d = normDesc(il.rawDescription);
    if (d && !invByDesc.has(d)) invByDesc.set(d, il);
  }
  const usedInvoiceIds = new Set<string>();
  const invForPoLine = new Map<string, InvoiceLineRow>();
  for (const pl of poLines) {
    let inv: InvoiceLineRow | undefined;
    if (pl.productId) inv = invByProduct.get(pl.productId);
    if (!inv) inv = invByDesc.get(normDesc(pl.rawDescription));
    if (!inv || usedInvoiceIds.has(inv.id)) continue;
    // A supplier may bill one ordered item on several invoice lines (two
    // deliveries, a split pallet). Fold every still-unpaired line for the same
    // product / description into one, or the halves would show as a qty gap
    // PLUS a "not ordered" line — a false ₪ alarm (EN-5).
    const key = normDesc(inv.rawDescription);
    const group = invoiceLines.filter(
      (il) =>
        !usedInvoiceIds.has(il.id) &&
        (il.id === inv.id ||
          (inv.productId ? il.productId === inv.productId : !il.productId && normDesc(il.rawDescription) === key)),
    );
    for (const il of group) usedInvoiceIds.add(il.id);
    invForPoLine.set(pl.id, group.length === 1 ? inv : foldInvoiceLines(group));
  }
  // EN-5 (calm UX): only claim "missing on invoice" when the comparison is
  // conclusive. With no invoice at all, or with invoice lines we could not
  // link to a product, an unpaired PO line is "pending review", not a leak.
  const hasUnlinkedInvoiceLines = invoiceLines.some(
    (il) => !usedInvoiceIds.has(il.id) && !il.productId,
  );
  const missingIsConclusive = invoiceLines.length > 0 && !hasUnlinkedInvoiceLines;

  const lines: ReconciliationLine[] = [];
  const grLineIdByKey: Record<string, string> = {};
  const initialMarks: Record<string, LineMark> = {};

  let invoiceLineIndexCounter = 0;

  // 1. One row per PO line (matched / qty / price / missing).
  poLines.forEach((pl) => {
    const gr = grByPoLine.get(pl.id);
    const poQty = num(pl.qtyOrdered);
    const poPrice = num(pl.unitPriceExpected);
    const productName = gr?.productName ?? pl.rawDescription ?? labels.unnamed;

    const inv = invForPoLine.get(pl.id);
    const invoiceQty = inv ? num(inv.qtyBilled) : null;
    const invoicePrice = inv ? num(inv.unitPriceBilled) : null;
    const invoiceLineIndex = inv ? invoiceLineIndexCounter++ : null;

    const derived = deriveStatus(poQty, invoiceQty, poPrice, invoicePrice);
    const { status, deltaIls } =
      (derived.status === 'missing_from_invoice' && !missingIsConclusive) ||
      (inv && isUnreadable(invoiceQty, invoicePrice))
        ? { status: 'pending_review' as const, deltaIls: 0 }
        : derived;

    const line: ReconciliationLine = {
      invoiceLineIndex,
      poLineId: pl.id,
      productId: pl.productId,
      productName,
      // English: the name shown in Hebrew is the product's canonical name when
      // linked, so prefer the product's English, then the line's.
      productNameEn:
        (gr?.productName ? gr.productNameEn : null) ??
        pl.productNameEn ??
        pl.rawDescriptionEn ??
        gr?.productNameEn ??
        inv?.rawDescriptionEn ??
        null,
      poQty,
      poUnit: pl.unit ?? null,
      invoiceQty,
      invoiceUnit: inv?.unit ?? null,
      poUnitPrice: poPrice,
      invoiceUnitPrice: invoicePrice,
      invoiceLineTotal: inv ? num(inv.lineTotal) : null,
      status,
      deltaIls: Math.round(deltaIls * 100) / 100,
    };
    lines.push(line);

    const key = lineKey(line);
    if (gr) grLineIdByKey[key] = gr.grLineId;

    initialMarks[key] = markFromReceipt(line, gr, poQty ?? 0);
  });

  // 2. Invoice lines that never matched a PO line. A line linked to a known
  // product that isn't on the order is a real "not ordered" arrival; a line we
  // simply couldn't link (OCR text vs catalog) is "pending review" — no ₪
  // alarm until a human or the matching engine confirms it (EN-5).
  invoiceLines.forEach((il) => {
    if (usedInvoiceIds.has(il.id)) return;
    const invoiceQty = num(il.qtyBilled);
    const invoicePrice = num(il.unitPriceBilled);
    const conclusive = Boolean(il.productId) && !isUnreadable(invoiceQty, invoicePrice);
    const line: ReconciliationLine = {
      invoiceLineIndex: invoiceLineIndexCounter++,
      poLineId: null,
      productId: il.productId,
      productName: il.rawDescription ?? labels.unordered,
      productNameEn: il.rawDescriptionEn ?? il.productNameEn ?? null,
      poQty: null,
      poUnit: null,
      invoiceQty,
      invoiceUnit: il.unit ?? null,
      poUnitPrice: null,
      invoiceUnitPrice: invoicePrice,
      invoiceLineTotal: num(il.lineTotal),
      status: conclusive ? 'unordered' : 'pending_review',
      deltaIls: conclusive ? Math.round((invoiceQty ?? 0) * (invoicePrice ?? 0) * 100) / 100 : 0,
    };
    lines.push(line);
    const key = lineKey(line);
    initialMarks[key] = {
      poLineId: null,
      invoiceLineIndex: line.invoiceLineIndex,
      productId: line.productId,
      productName: line.productName,
      // Billed but not ordered: nothing is assumed to have arrived — the
      // receiver counts it (a count never comes from the invoice).
      qtyReceived: 0,
      qtyRejected: 0,
      condition: 'ok',
      touched: false,
    };
  });

  // Summary counts + headline ₪ leak.
  const summary = {
    matchedCount: 0,
    qtyDiffCount: 0,
    priceDiffCount: 0,
    unorderedCount: 0,
    missingCount: 0,
    pendingCount: 0,
    overallConfidence: num(invoiceMeta?.ocrConfidence) ?? 1,
    headlineDelta: 0,
  };
  for (const l of lines) {
    if (l.status === 'matched') summary.matchedCount += 1;
    if (l.status === 'qty_diff') summary.qtyDiffCount += 1;
    if (l.status === 'price_diff') summary.priceDiffCount += 1;
    if (l.status === 'unordered') summary.unorderedCount += 1;
    if (l.status === 'missing_from_invoice') summary.missingCount += 1;
    if (l.status === 'pending_review') summary.pendingCount += 1;
    summary.headlineDelta += l.deltaIls;
  }
  summary.headlineDelta = Math.round(summary.headlineDelta * 100) / 100;

  const result: ReconciliationResult = {
    invoiceMeta: {
      invoiceNumber: invoiceMeta?.invoiceNumber ?? '—',
      invoiceDate: '',
      totalInclVat: 0,
      ocrConfidence: num(invoiceMeta?.ocrConfidence) ?? 1,
      noInvoice: invoiceLines.length === 0,
    },
    matchedSupplierId: po.supplierId,
    matchedPoIds: [po.id],
    lines,
    summary,
  };

  return { result, grLineIdByKey, initialMarks };
}

/**
 * Seed a line's mark from what the Delivery Check already saved on its gr_line
 * (a reload / a resumed receipt restores every mark, and how it was counted),
 * else pre-fill the editor with the ORDERED quantity, UNRESOLVED. "Invoice =
 * order" is never "arrived" (RCV-01), and the invoice never stands in for a
 * count: `defaultQty` is the order (0 for a line that was not ordered).
 */
export function markFromReceipt(
  line: Pick<ReconciliationLine, 'poLineId' | 'invoiceLineIndex' | 'productId' | 'productName'>,
  gr: ReceiptLineRow | undefined,
  defaultQty: number,
): LineMark {
  return markFromCount(line, fromGrLine(gr, defaultQty), defaultQty, gr?.conditionNotes ?? null);
}

/** The UI mark for a count (`defaultQty` only pre-fills the editor of an uncounted line). */
export function markFromCount(
  line: Pick<ReconciliationLine, 'poLineId' | 'invoiceLineIndex' | 'productId' | 'productName'>,
  count: LineCount,
  defaultQty: number,
  notes: string | null = null,
): LineMark {
  const base = {
    poLineId: line.poLineId,
    invoiceLineIndex: line.invoiceLineIndex,
    productId: line.productId,
    productName: line.productName,
  };
  if (count.kind === 'uncounted') {
    return { ...base, qtyReceived: defaultQty, qtyRejected: 0, condition: 'ok', rejectReason: null, touched: false };
  }
  const damaged = count.outcome === 'damaged';
  return {
    ...base,
    qtyReceived: count.qtyReceived,
    qtyRejected: count.qtyRejected,
    condition: damaged ? 'damaged' : count.qtyRejected > 0 ? 'rejected' : 'ok',
    rejectReason: count.outcome === 'missing' ? 'missing' : damaged ? 'damaged' : null,
    touched: true,
    method: count.method,
    // What a person wrote, without the method token or the server's "damaged:" prefix
    // (re-saving re-adds both, never twice).
    ...(personNotes(notes) ? { notes: personNotes(notes) } : {}),
  };
}

function personNotes(notes: string | null): string {
  return stripMethod(notes).replace(/^damaged:\s*/, '').trim();
}

/** The count a UI mark stands for (an unresolved mark is `uncounted`, whatever it pre-fills). */
export function countFromMark(mark: LineMark): LineCount {
  if (!mark.touched) return UNCOUNTED;
  const method = mark.method ?? 'per_line';
  if (mark.rejectReason === 'missing') return { kind: 'counted', qtyReceived: 0, qtyRejected: 0, outcome: 'missing', method };
  if (mark.condition === 'damaged') {
    return { kind: 'counted', qtyReceived: mark.qtyReceived, qtyRejected: mark.qtyRejected, outcome: 'damaged', method };
  }
  return { kind: 'counted', qtyReceived: mark.qtyReceived, qtyRejected: mark.qtyRejected, outcome: 'counted', method };
}

/** The gr_line row to save for a mark. */
export function grLineForMark(mark: LineMark): GrLineFields {
  return toGrLine(countFromMark(mark), mark.notes);
}

/**
 * Rebuild marks for a new review projection without losing what the receiver
 * already counted: for every line they adjusted by hand, keep their quantity /
 * rejection / condition; everything else takes the fresh defaults.
 */
export function keepAdjusted(
  prev: Record<string, LineMark>,
  next: Record<string, LineMark>,
  adjustedKeys: ReadonlySet<string>,
): Record<string, LineMark> {
  const out: Record<string, LineMark> = { ...next };
  for (const key of adjustedKeys) {
    const p = prev[key];
    const n = next[key];
    if (!p || !n) continue;
    out[key] = {
      ...n,
      qtyReceived: p.qtyReceived,
      qtyRejected: p.qtyRejected,
      condition: p.condition,
      rejectReason: p.rejectReason ?? null,
      touched: p.touched,
      method: p.method,
    };
  }
  return out;
}
