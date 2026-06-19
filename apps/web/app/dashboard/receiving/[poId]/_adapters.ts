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
  qtyOrdered: string | number;
  unit: string;
  unitPriceExpected: string | number | null;
}
export interface ReceiptLineRow {
  grLineId: string;
  poLineId: string | null;
  productId: string | null;
  productName: string | null;
  rawDescription: string | null;
  orderedQty: string | number | null;
  unit: string | null;
  qtyReceived: string | number | null;
  qtyRejected: string | number | null;
}
export interface InvoiceLineRow {
  id: string;
  productId: string | null;
  rawDescription: string | null;
  qtyBilled: string | number | null;
  unit: string | null;
  unitPriceBilled: string | number | null;
  lineTotal: string | number | null;
}
export interface InvoiceMeta {
  invoiceNumber: string | null;
  ocrConfidence: string | number | null;
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
 * before an invoice is registered) — in that case we project the PO lines alone
 * so the table still renders the order, all as `matched` placeholders driven by
 * the receipt's recorded qty.
 */
export function adaptReconciliation(args: {
  po: PoHeader;
  poLines: PoLineRow[];
  receiptLines: ReceiptLineRow[];
  invoiceLines?: InvoiceLineRow[];
  invoiceMeta?: InvoiceMeta | null;
}): ReceivingAdaptResult {
  const { po, poLines, receiptLines, invoiceLines = [], invoiceMeta } = args;

  // grLineId + recorded qty lookup keyed by poLineId.
  const grByPoLine = new Map<string, ReceiptLineRow>();
  for (const r of receiptLines) {
    if (r.poLineId) grByPoLine.set(r.poLineId, r);
  }

  // Best-effort invoice line lookup by productId, then by raw description.
  const invByProduct = new Map<string, InvoiceLineRow>();
  const invByDesc = new Map<string, InvoiceLineRow>();
  for (const il of invoiceLines) {
    if (il.productId) invByProduct.set(il.productId, il);
    if (il.rawDescription) invByDesc.set(il.rawDescription.trim(), il);
  }
  const usedInvoiceIds = new Set<string>();

  const lines: ReconciliationLine[] = [];
  const grLineIdByKey: Record<string, string> = {};
  const initialMarks: Record<string, LineMark> = {};

  let invoiceLineIndexCounter = 0;

  // 1. One row per PO line (matched / qty / price / missing).
  poLines.forEach((pl) => {
    const gr = grByPoLine.get(pl.id);
    const poQty = num(pl.qtyOrdered);
    const poPrice = num(pl.unitPriceExpected);
    const productName = gr?.productName ?? pl.rawDescription ?? 'פריט ללא שם';

    let inv: InvoiceLineRow | undefined;
    if (pl.productId) inv = invByProduct.get(pl.productId);
    if (!inv && pl.rawDescription) inv = invByDesc.get(pl.rawDescription.trim());
    if (inv) usedInvoiceIds.add(inv.id);

    const invoiceQty = inv ? num(inv.qtyBilled) : null;
    const invoicePrice = inv ? num(inv.unitPriceBilled) : null;
    const invoiceLineIndex = inv ? invoiceLineIndexCounter++ : null;

    const { status, deltaIls } = deriveStatus(poQty, invoiceQty, poPrice, invoicePrice);

    const line: ReconciliationLine = {
      invoiceLineIndex,
      poLineId: pl.id,
      productId: pl.productId,
      productName,
      poQty,
      poUnit: pl.unit ?? null,
      invoiceQty,
      invoiceUnit: inv?.unit ?? null,
      poUnitPrice: poPrice,
      invoiceUnitPrice: invoicePrice,
      status,
      deltaIls: Math.round(deltaIls * 100) / 100,
    };
    lines.push(line);

    const key = lineKey(line);
    if (gr) grLineIdByKey[key] = gr.grLineId;

    // Seed the mark from what was already received (or default to expected qty).
    const recordedReceived = gr ? num(gr.qtyReceived) : null;
    const recordedRejected = gr ? num(gr.qtyRejected) : null;
    const defaultQty =
      recordedReceived !== null && recordedReceived > 0
        ? recordedReceived
        : invoiceQty ?? poQty ?? 0;
    initialMarks[key] = {
      poLineId: line.poLineId,
      invoiceLineIndex: line.invoiceLineIndex,
      productId: line.productId,
      productName: line.productName,
      qtyReceived: defaultQty,
      qtyRejected: recordedRejected ?? 0,
      condition: (recordedRejected ?? 0) > 0 ? 'rejected' : 'ok',
      touched: status === 'matched' || (recordedReceived !== null && recordedReceived > 0),
    };
  });

  // 2. Invoice lines that never matched a PO line → unordered arrivals.
  invoiceLines.forEach((il) => {
    if (usedInvoiceIds.has(il.id)) return;
    const invoiceQty = num(il.qtyBilled);
    const invoicePrice = num(il.unitPriceBilled);
    const line: ReconciliationLine = {
      invoiceLineIndex: invoiceLineIndexCounter++,
      poLineId: null,
      productId: il.productId,
      productName: il.rawDescription ?? 'פריט שלא הוזמן',
      poQty: null,
      poUnit: null,
      invoiceQty,
      invoiceUnit: il.unit ?? null,
      poUnitPrice: null,
      invoiceUnitPrice: invoicePrice,
      status: 'unordered',
      deltaIls: Math.round((invoiceQty ?? 0) * (invoicePrice ?? 0) * 100) / 100,
    };
    lines.push(line);
    const key = lineKey(line);
    initialMarks[key] = {
      poLineId: null,
      invoiceLineIndex: line.invoiceLineIndex,
      productId: line.productId,
      productName: line.productName,
      qtyReceived: invoiceQty ?? 0,
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
    overallConfidence: num(invoiceMeta?.ocrConfidence) ?? 1,
    headlineDelta: 0,
  };
  for (const l of lines) {
    if (l.status === 'matched') summary.matchedCount += 1;
    if (l.status === 'qty_diff') summary.qtyDiffCount += 1;
    if (l.status === 'price_diff') summary.priceDiffCount += 1;
    if (l.status === 'unordered') summary.unorderedCount += 1;
    if (l.status === 'missing_from_invoice') summary.missingCount += 1;
    summary.headlineDelta += l.deltaIls;
  }
  summary.headlineDelta = Math.round(summary.headlineDelta * 100) / 100;

  const result: ReconciliationResult = {
    invoiceMeta: {
      invoiceNumber: invoiceMeta?.invoiceNumber ?? '—',
      invoiceDate: '',
      totalInclVat: 0,
      ocrConfidence: num(invoiceMeta?.ocrConfidence) ?? 1,
    },
    matchedSupplierId: po.supplierId,
    matchedPoIds: [po.id],
    lines,
    summary,
  };

  return { result, grLineIdByKey, initialMarks };
}
