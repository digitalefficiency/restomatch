import type { Tolerances } from '@restomatch/types';

export type ReconciliationLineStatus =
  | 'matched'
  | 'qty_diff'
  | 'price_diff'
  | 'unordered'
  | 'missing_from_invoice';

export interface PoLineRef {
  id: string;
  productId: string | null;
  qtyOrdered: number;
  unit: string;
  unitPriceExpected: number | null;
  rawDescription?: string;
}

export interface InvoiceLineRef {
  productId: string | null;
  rawDescription: string;
  qtyBilled: number;
  unit: string;
  unitPriceBilled: number;
  lineTotal: number;
}

export interface ReconciliationLine {
  invoiceLineIndex: number | null;
  poLineId: string | null;
  productId: string | null;
  productName: string;
  poQty: number | null;
  poUnit: string | null;
  invoiceQty: number | null;
  invoiceUnit: string | null;
  poUnitPrice: number | null;
  invoiceUnitPrice: number | null;
  status: ReconciliationLineStatus;
  deltaIls: number;
}

export interface ReconciliationSummary {
  matchedCount: number;
  qtyDiffCount: number;
  priceDiffCount: number;
  unorderedCount: number;
  missingCount: number;
  overallConfidence: number;
  headlineDelta: number;
}

export interface ReconciliationResult {
  lines: ReconciliationLine[];
  summary: ReconciliationSummary;
}

const DEFAULT_TOLERANCES: Required<Tolerances> = {
  pricePercent: 0.02,
  priceAbsolute: 5,
  qtyPercent: 0.03,
  qtyAbsolute: 1,
  blockPricePercent: 0.1,
};

/**
 * Reconcile an invoice (parsed by OCR) against one or more PO line sets,
 * producing a per-line comparison + summary suitable for UI display.
 *
 * Matching strategy:
 *  1. Each invoice line is matched to a po_line by `productId` (1:1).
 *  2. PO lines without a matching invoice line → `missing_from_invoice`.
 *  3. Invoice lines without a matching po_line → `unordered`.
 *  4. For matched pairs, compare qty + price within tolerances:
 *      - qty within qtyPercent and qtyAbsolute → no qty issue
 *      - price within pricePercent and priceAbsolute → no price issue
 *      - both clean → status='matched'
 *      - else → status='qty_diff' OR 'price_diff' (whichever is higher delta);
 *        delta is computed as cost-impact in ILS.
 */
export function reconcileInvoiceToPo(input: {
  poLines: PoLineRef[];
  invoiceLines: InvoiceLineRef[];
  /** Optional per-invoice-line productId override (e.g. from human review of OCR) */
  productMatches?: Map<number, string | null>;
  /** Product display names keyed by productId, optional */
  productNames?: Map<string, string>;
  tolerances?: Partial<Tolerances>;
}): ReconciliationResult {
  const tolerances = { ...DEFAULT_TOLERANCES, ...input.tolerances };
  const productNames = input.productNames ?? new Map();

  // Build effective productId per invoice line (override > line.productId)
  const effectiveInvoiceProductIds = input.invoiceLines.map((line, idx) => {
    if (input.productMatches?.has(idx)) {
      return input.productMatches.get(idx) ?? null;
    }
    return line.productId;
  });

  // Map productId → indexes for invoice lookups
  const invoiceByProduct = new Map<string, number[]>();
  effectiveInvoiceProductIds.forEach((pid, idx) => {
    if (pid) {
      const arr = invoiceByProduct.get(pid) ?? [];
      arr.push(idx);
      invoiceByProduct.set(pid, arr);
    }
  });

  const usedInvoiceIndexes = new Set<number>();
  const lines: ReconciliationLine[] = [];

  // Pass 1: each PO line, try to find matching invoice line
  for (const po of input.poLines) {
    if (!po.productId) {
      // PO line without product — flag as missing (cannot be matched)
      lines.push({
        invoiceLineIndex: null,
        poLineId: po.id,
        productId: null,
        productName: po.rawDescription ?? 'פריט ללא זיהוי',
        poQty: po.qtyOrdered,
        poUnit: po.unit,
        invoiceQty: null,
        invoiceUnit: null,
        poUnitPrice: po.unitPriceExpected,
        invoiceUnitPrice: null,
        status: 'missing_from_invoice',
        deltaIls: 0,
      });
      continue;
    }

    const candidateIdxs = invoiceByProduct.get(po.productId) ?? [];
    const availableIdx = candidateIdxs.find((i) => !usedInvoiceIndexes.has(i));

    if (availableIdx === undefined) {
      lines.push({
        invoiceLineIndex: null,
        poLineId: po.id,
        productId: po.productId,
        productName: productNames.get(po.productId) ?? po.rawDescription ?? '—',
        poQty: po.qtyOrdered,
        poUnit: po.unit,
        invoiceQty: null,
        invoiceUnit: null,
        poUnitPrice: po.unitPriceExpected,
        invoiceUnitPrice: null,
        status: 'missing_from_invoice',
        deltaIls: 0,
      });
      continue;
    }

    usedInvoiceIndexes.add(availableIdx);
    const inv = input.invoiceLines[availableIdx]!;
    lines.push(buildMatchedLine(po, inv, availableIdx, tolerances, productNames));
  }

  // Pass 2: invoice lines not consumed → unordered
  input.invoiceLines.forEach((inv, idx) => {
    if (usedInvoiceIndexes.has(idx)) return;
    const pid = effectiveInvoiceProductIds[idx] ?? null;
    lines.push({
      invoiceLineIndex: idx,
      poLineId: null,
      productId: pid,
      productName:
        (pid ? productNames.get(pid) : null) ?? inv.rawDescription ?? 'פריט לא ידוע',
      poQty: null,
      poUnit: null,
      invoiceQty: inv.qtyBilled,
      invoiceUnit: inv.unit,
      poUnitPrice: null,
      invoiceUnitPrice: inv.unitPriceBilled,
      status: 'unordered',
      deltaIls: inv.lineTotal,
    });
  });

  // Summary aggregation
  const summary = aggregateSummary(lines);
  return { lines, summary };
}

function buildMatchedLine(
  po: PoLineRef,
  inv: InvoiceLineRef,
  invoiceIdx: number,
  tolerances: Required<Tolerances>,
  productNames: Map<string, string>,
): ReconciliationLine {
  const productName =
    (po.productId ? productNames.get(po.productId) : null) ??
    inv.rawDescription ??
    po.rawDescription ??
    '—';

  const qtyDelta = inv.qtyBilled - po.qtyOrdered;
  const qtyDeltaPct = po.qtyOrdered > 0 ? Math.abs(qtyDelta) / po.qtyOrdered : 0;
  const qtyClean =
    Math.abs(qtyDelta) <= tolerances.qtyAbsolute || qtyDeltaPct <= tolerances.qtyPercent;

  const priceDelta =
    po.unitPriceExpected !== null ? inv.unitPriceBilled - po.unitPriceExpected : 0;
  const priceDeltaPct =
    po.unitPriceExpected && po.unitPriceExpected > 0
      ? Math.abs(priceDelta) / po.unitPriceExpected
      : 0;
  // Price tolerance is percent-only. Hebrew restaurant context — a 25%
  // hike on a cheap item is meaningful even when the absolute shekel
  // delta is small. priceAbsolute is reserved for the runMatch engine
  // which uses tiered severity, not for this binary clean/diff check.
  const priceClean =
    po.unitPriceExpected === null || priceDeltaPct <= tolerances.pricePercent;

  let status: ReconciliationLineStatus = 'matched';
  let deltaIls = 0;

  if (!qtyClean && !priceClean) {
    // Pick the bigger cost impact for primary status
    const priceImpact =
      po.unitPriceExpected !== null ? Math.abs(priceDelta) * inv.qtyBilled : 0;
    const qtyImpact =
      po.unitPriceExpected !== null
        ? Math.abs(qtyDelta) * po.unitPriceExpected
        : Math.abs(qtyDelta) * inv.unitPriceBilled;
    status = priceImpact >= qtyImpact ? 'price_diff' : 'qty_diff';
    deltaIls = Math.max(0, priceImpact + qtyImpact);
  } else if (!qtyClean) {
    status = 'qty_diff';
    deltaIls = Math.max(
      0,
      Math.abs(qtyDelta) * (po.unitPriceExpected ?? inv.unitPriceBilled),
    );
  } else if (!priceClean) {
    status = 'price_diff';
    deltaIls = Math.max(0, priceDelta) * inv.qtyBilled;
  }

  return {
    invoiceLineIndex: invoiceIdx,
    poLineId: po.id,
    productId: po.productId,
    productName,
    poQty: po.qtyOrdered,
    poUnit: po.unit,
    invoiceQty: inv.qtyBilled,
    invoiceUnit: inv.unit,
    poUnitPrice: po.unitPriceExpected,
    invoiceUnitPrice: inv.unitPriceBilled,
    status,
    deltaIls: Math.round(deltaIls * 100) / 100,
  };
}

function aggregateSummary(lines: ReconciliationLine[]): ReconciliationSummary {
  const counts = {
    matchedCount: 0,
    qtyDiffCount: 0,
    priceDiffCount: 0,
    unorderedCount: 0,
    missingCount: 0,
  };
  let headlineDelta = 0;
  for (const l of lines) {
    if (l.status === 'matched') counts.matchedCount += 1;
    if (l.status === 'qty_diff') counts.qtyDiffCount += 1;
    if (l.status === 'price_diff') counts.priceDiffCount += 1;
    if (l.status === 'unordered') counts.unorderedCount += 1;
    if (l.status === 'missing_from_invoice') counts.missingCount += 1;
    headlineDelta += l.deltaIls;
  }
  const total = lines.length || 1;
  const overallConfidence = counts.matchedCount / total;
  return {
    ...counts,
    overallConfidence: Math.round(overallConfidence * 1000) / 1000,
    headlineDelta: Math.round(headlineDelta * 100) / 100,
  };
}
