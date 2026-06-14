import type { Tolerances } from '@restomatch/types';
import type {
  BaselineEntry,
  Discrepancy,
  DiscrepancyType,
  GrLineInput,
  InvoiceLineInput,
  MatchInput,
  MatchOutput,
  MatchStatus,
  PoLineInput,
  Severity,
} from './index';
import { unitConversionFactor } from './units';
import { mulIls, quantizeIls, sumIls, toAgorot, toShekels } from './money';

/* ──────────────────────────────────────────────────────────────────────────
 * Tunable thresholds (not exposed via Tolerances yet — sane defaults)
 * ────────────────────────────────────────────────────────────────────────── */

const WARN_QTY_PCT = 0.1; // qty pct >= 10% → warn (otherwise info)
const TOTAL_TOLERANCE_ILS = 0.1; // ₪0.10 rounding allowance for total/VAT
const DATE_ANOMALY_DAYS = 7; // > 7 days between invoiceDate and expected delivery

/* ──────────────────────────────────────────────────────────────────────────
 * Discrepancy builder helpers
 * ────────────────────────────────────────────────────────────────────────── */

function discrepancy(
  type: DiscrepancyType,
  severity: Severity,
  fields: Omit<Discrepancy, 'type' | 'severity'>,
): Discrepancy {
  return { type, severity, ...fields };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Price tolerance evaluation
 *
 *   • Within both pricePercent AND priceAbsolute → no discrepancy (clean)
 *   • PRICE_LOWER (actual < expected) → always info (positive surprise)
 *   • pct ≥ blockPricePercent → block
 *   • Otherwise → warn
 * ────────────────────────────────────────────────────────────────────────── */

function evaluatePrice(
  expected: number,
  actual: number,
  qty: number,
  tolerances: Tolerances,
): { discrepancy: Omit<Discrepancy, 'type' | 'severity'> & { type: DiscrepancyType; severity: Severity } } | null {
  const diff = actual - expected;
  const absDiff = Math.abs(diff);
  const pct = expected > 0 ? absDiff / expected : 1;

  if (pct <= tolerances.pricePercent && absDiff <= tolerances.priceAbsolute) {
    return null;
  }

  const type: DiscrepancyType = diff < 0 ? 'PRICE_LOWER' : 'PRICE_HIGHER';
  let severity: Severity;
  if (type === 'PRICE_LOWER') {
    severity = 'info';
  } else if (pct >= tolerances.blockPricePercent) {
    severity = 'block';
  } else {
    severity = 'warn';
  }

  return {
    discrepancy: {
      type,
      severity,
      productId: null,
      expected,
      actual,
      deltaAmount: mulIls(absDiff, qty),
      toleranceUsed: `price: ±${tolerances.pricePercent * 100}% or ₪${tolerances.priceAbsolute}`,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Quantity tolerance evaluation
 *
 *   effectiveTol = max(qtyAbsolute, qtyOrdered × qtyPercent)
 *
 *   • |diff| ≤ effectiveTol AND pct ≤ qtyPercent → clean
 *   • |diff| ≤ effectiveTol (within absolute band but big percent) → info
 *   • pct ≥ WARN_QTY_PCT → warn
 *   • Otherwise → info
 * ────────────────────────────────────────────────────────────────────────── */

function evaluateQty(
  ordered: number,
  received: number,
  unitPrice: number,
  tolerances: Tolerances,
): { discrepancy: Omit<Discrepancy, 'type' | 'severity'> & { type: DiscrepancyType; severity: Severity } } | null {
  const diff = received - ordered;
  const absDiff = Math.abs(diff);
  const pct = ordered > 0 ? absDiff / ordered : 1;
  const effectiveTol = Math.max(tolerances.qtyAbsolute, ordered * tolerances.qtyPercent);

  if (absDiff <= effectiveTol && pct <= tolerances.qtyPercent) {
    return null;
  }

  const type: DiscrepancyType = diff < 0 ? 'QTY_SHORT' : 'QTY_OVER';
  let severity: Severity;
  if (absDiff <= effectiveTol) {
    severity = 'info';
  } else if (pct >= WARN_QTY_PCT) {
    severity = 'warn';
  } else {
    severity = 'info';
  }

  return {
    discrepancy: {
      type,
      severity,
      productId: null,
      expected: ordered,
      actual: received,
      deltaAmount: mulIls(unitPrice, absDiff),
      toleranceUsed: `qty: ±${tolerances.qtyPercent * 100}% or ${tolerances.qtyAbsolute} units`,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Main entry point
 * ────────────────────────────────────────────────────────────────────────── */

export function runMatch(input: MatchInput): MatchOutput {
  const out: Discrepancy[] = [];
  const { poLines, grLines, invoiceLines, tolerances, vatRate, invoice } = input;

  // 1. Duplicate invoice detection
  if (input.knownInvoiceNumbers?.has(invoice.invoiceNumber)) {
    out.push(
      discrepancy('DUPLICATE_INVOICE', 'block', {
        productId: null,
        expected: null,
        actual: null,
        deltaAmount: quantizeIls(invoice.totalInclVat),
        toleranceUsed: 'invoice number uniqueness per supplier',
        message: `Invoice number ${invoice.invoiceNumber} already exists for supplier ${invoice.supplierId}`,
      }),
    );
  }

  // 2. Date anomaly (if expected delivery known)
  if (input.expectedDeliveryDate) {
    const dayMs = 24 * 60 * 60 * 1000;
    const dayDiff =
      Math.abs(invoice.invoiceDate.getTime() - input.expectedDeliveryDate.getTime()) / dayMs;
    if (dayDiff > DATE_ANOMALY_DAYS) {
      out.push(
        discrepancy('DATE_ANOMALY', 'warn', {
          productId: null,
          expected: input.expectedDeliveryDate.getTime(),
          actual: invoice.invoiceDate.getTime(),
          deltaAmount: 0,
          toleranceUsed: `±${DATE_ANOMALY_DAYS} days from expected delivery`,
          message: `Invoice date ${invoice.invoiceDate.toISOString()} is ${dayDiff.toFixed(1)} days from expected delivery`,
        }),
      );
    }
  }

  // 3. Unordered arrival — invoice without any PO at all
  if (poLines.length === 0 && invoiceLines.length > 0) {
    out.push(
      discrepancy('UNORDERED_ARRIVAL', 'block', {
        productId: null,
        expected: null,
        actual: null,
        deltaAmount: quantizeIls(invoice.totalInclVat),
        toleranceUsed: 'PO must exist for invoice',
        message: 'Invoice arrived without any matching purchase order',
      }),
    );
  }

  // 4. Build lookup maps
  const grByPoLineId = new Map<string, GrLineInput>();
  for (const gr of grLines) {
    if (gr.poLineId) grByPoLineId.set(gr.poLineId, gr);
  }

  const invoiceLinesByProduct = new Map<string, InvoiceLineInput[]>();
  for (const il of invoiceLines) {
    const key = il.productId ?? '';
    const list = invoiceLinesByProduct.get(key) ?? [];
    list.push(il);
    invoiceLinesByProduct.set(key, list);
  }

  const matchedInvoiceLineIds = new Set<string>();

  // 5. Per-PO-line analysis
  for (const po of poLines) {
    const gr = grByPoLineId.get(po.id);
    const invLines = po.productId ? invoiceLinesByProduct.get(po.productId) ?? [] : [];
    const inv = invLines.find((l) => !matchedInvoiceLineIds.has(l.id));
    if (inv) matchedInvoiceLineIds.add(inv.id);

    // 5a. Qty: ordered vs received
    if (gr) {
      const qtyEval = evaluateQty(po.qtyOrdered, gr.qtyReceived, po.unitPriceExpected ?? 0, tolerances);
      if (qtyEval) {
        out.push(
          discrepancy(qtyEval.discrepancy.type, qtyEval.discrepancy.severity, {
            ...qtyEval.discrepancy,
            productId: po.productId,
            poLineId: po.id,
            grLineId: gr.id,
            invoiceLineId: inv?.id ?? null,
          }),
        );
      }
    }

    if (inv) {
      // 5c. Unit handling — convert when units differ but are convertible
      // (e.g. kg↔g, l↔ml); only flag UNIT_MISMATCH when no conversion exists.
      // All downstream qty/price checks then use the PO-unit-normalized values.
      let invQty = inv.qtyBilled;
      let invPrice = inv.unitPriceBilled;
      if (inv.unit !== po.unit) {
        const factor = unitConversionFactor(inv.unit, po.unit);
        if (factor === null) {
          out.push(
            discrepancy('UNIT_MISMATCH', 'warn', {
              productId: po.productId,
              poLineId: po.id,
              invoiceLineId: inv.id,
              expected: null,
              actual: null,
              deltaAmount: 0,
              toleranceUsed: 'unit must match between PO and invoice',
              message: `PO unit "${po.unit}" vs invoice unit "${inv.unit}"`,
            }),
          );
        } else {
          invQty = inv.qtyBilled * factor;
          invPrice = inv.unitPriceBilled / factor;
        }
      }

      // 5b. Billed > received: block (overcharge)
      if (gr && invQty > gr.qtyReceived) {
        const diff = invQty - gr.qtyReceived;
        const effectiveTol = Math.max(
          tolerances.qtyAbsolute,
          gr.qtyReceived * tolerances.qtyPercent,
        );
        if (diff > effectiveTol) {
          out.push(
            discrepancy('QTY_OVER', 'block', {
              productId: po.productId,
              poLineId: po.id,
              grLineId: gr.id,
              invoiceLineId: inv.id,
              expected: gr.qtyReceived,
              actual: invQty,
              deltaAmount: mulIls(invPrice, diff),
              toleranceUsed: 'billed quantity exceeds received quantity',
              message: 'Invoice charges for more units than were received',
            }),
          );
        }
      }

      // 5d. Price comparison: PO expected vs invoice billed (unit-normalized)
      if (po.unitPriceExpected !== null) {
        const priceEval = evaluatePrice(po.unitPriceExpected, invPrice, invQty, tolerances);
        if (priceEval) {
          out.push(
            discrepancy(priceEval.discrepancy.type, priceEval.discrepancy.severity, {
              ...priceEval.discrepancy,
              productId: po.productId,
              poLineId: po.id,
              invoiceLineId: inv.id,
            }),
          );
        }
      }

      // 5e. Baseline price check (when historical data is available)
      const baseline = po.productId ? input.baselines?.[po.productId] : undefined;
      if (baseline) {
        const baselineDiscrepancy = evaluateBaseline(
          po.unitPriceExpected,
          inv.unitPriceBilled,
          inv.qtyBilled,
          baseline,
          tolerances,
        );
        if (baselineDiscrepancy) {
          out.push(
            discrepancy(baselineDiscrepancy.type, baselineDiscrepancy.severity, {
              ...baselineDiscrepancy,
              productId: po.productId,
              poLineId: po.id,
              invoiceLineId: inv.id,
            }),
          );
        }
      }
    } else {
      // 5f. Missing on invoice (PO line not invoiced)
      out.push(
        discrepancy('MISSING_ON_INVOICE', 'warn', {
          productId: po.productId,
          poLineId: po.id,
          grLineId: gr?.id ?? null,
          expected: po.qtyOrdered,
          actual: 0,
          deltaAmount: mulIls(po.unitPriceExpected ?? 0, po.qtyOrdered),
          toleranceUsed: 'PO line must appear on invoice',
        }),
      );
    }
  }

  // 6. Unordered items (only when PO exists but specific invoice line is unmatched)
  if (poLines.length > 0) {
    for (const il of invoiceLines) {
      if (matchedInvoiceLineIds.has(il.id)) continue;
      out.push(
        discrepancy('UNORDERED_ITEM', 'block', {
          productId: il.productId,
          invoiceLineId: il.id,
          expected: null,
          actual: il.qtyBilled,
          deltaAmount: quantizeIls(il.lineTotal),
          toleranceUsed: 'invoice line must match a PO line',
          message: `Invoice line for ${il.productId ?? 'unknown product'} has no matching PO line`,
        }),
      );
    }
  }

  // 7. TOTAL_MISMATCH — sum of line totals vs invoice subtotal (compared in agorot)
  const linesSum = sumIls(invoiceLines.map((l) => l.lineTotal));
  const totalDiffAgorot = Math.abs(toAgorot(linesSum) - toAgorot(invoice.totalExclVat));
  if (invoiceLines.length > 0 && totalDiffAgorot > toAgorot(TOTAL_TOLERANCE_ILS)) {
    out.push(
      discrepancy('TOTAL_MISMATCH', 'block', {
        productId: null,
        expected: linesSum,
        actual: invoice.totalExclVat,
        deltaAmount: toShekels(totalDiffAgorot),
        toleranceUsed: `±₪${TOTAL_TOLERANCE_ILS}`,
        message: `Lines sum to ₪${linesSum.toFixed(2)} but invoice subtotal claims ₪${invoice.totalExclVat.toFixed(2)}`,
      }),
    );
  }

  // 8. VAT_MISMATCH — vat amount vs subtotal × vatRate (compared in agorot)
  const expectedVat = quantizeIls(invoice.totalExclVat * vatRate);
  const vatDiffAgorot = Math.abs(toAgorot(invoice.vatAmount) - toAgorot(expectedVat));
  if (invoiceLines.length > 0 && vatDiffAgorot > toAgorot(TOTAL_TOLERANCE_ILS)) {
    out.push(
      discrepancy('VAT_MISMATCH', 'warn', {
        productId: null,
        expected: expectedVat,
        actual: invoice.vatAmount,
        deltaAmount: toShekels(vatDiffAgorot),
        toleranceUsed: `${vatRate * 100}% VAT on subtotal, ±₪${TOTAL_TOLERANCE_ILS}`,
      }),
    );
  }

  // 9. Compute totals & overall status. Summed in integer agorot so the leak
  // figure is exact no matter how many discrepancy lines contribute.
  const totalDiscrepancyAmount = sumIls(out.map((d) => Math.abs(d.deltaAmount)));
  const status = deriveStatus(out);

  return {
    status,
    totalDiscrepancyAmount,
    discrepancies: out,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Baseline-driven price anomaly detection
 *
 * Flags when invoice price exceeds the supplier's historical p90 by more
 * than a small margin. Severity scales with how far above the PO's expected
 * price (so within-PO surprises are warn; far-outside are block).
 * ────────────────────────────────────────────────────────────────────────── */

function evaluateBaseline(
  expectedPrice: number | null,
  actualPrice: number,
  qty: number,
  baseline: BaselineEntry,
  tolerances: Tolerances,
): { type: DiscrepancyType; severity: Severity } & Omit<Discrepancy, 'type' | 'severity'> | null {
  if (actualPrice <= baseline.p90) return null;
  // Don't double-fire if PO expected price already triggered a discrepancy at warn/block
  const reference = expectedPrice ?? baseline.p50;
  const pctFromExpected = reference > 0 ? Math.abs(actualPrice - reference) / reference : 0;

  // Skip if within tolerance of PO expected (the per-PO check handles it)
  if (
    expectedPrice !== null &&
    pctFromExpected <= tolerances.pricePercent &&
    Math.abs(actualPrice - expectedPrice) <= tolerances.priceAbsolute
  ) {
    return null;
  }

  const severity: Severity = pctFromExpected >= tolerances.blockPricePercent ? 'block' : 'warn';
  return {
    type: 'PRICE_HIGHER',
    severity,
    productId: null,
    expected: baseline.p90,
    actual: actualPrice,
    deltaAmount: mulIls(actualPrice - baseline.p90, qty),
    toleranceUsed: `actual exceeds historical p90 of ₪${baseline.p90}`,
    message: `Price ₪${actualPrice} exceeds supplier's 90th-percentile (₪${baseline.p90})`,
  };
}

function deriveStatus(discrepancies: Discrepancy[]): MatchStatus {
  if (discrepancies.length === 0) return 'clean';
  if (discrepancies.some((d) => d.severity === 'block')) return 'blocked';
  if (discrepancies.some((d) => d.severity === 'warn')) return 'major';
  return 'minor';
}
