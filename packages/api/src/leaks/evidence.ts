import type { LeakBreakdownInvoice, LeakBreakdownLine, LeakExpectedSource } from '@restomatch/charts';
import { mulIls, quantizeIls, toAgorot, unitConversionFactor } from '@restomatch/matching';
import { deliveryNoteNumberIn } from '../match/consolidated';

/**
 * W2-09c · every leak ₪ explains itself (deep-fix class 11).
 *
 * For one breakdown line, rebuild the engine's own formula from the stored
 * facts with the engine's own `mulIls` / `unitConversionFactor` (never a
 * re-implementation) and check it against the stored |Δ| to the agora:
 *   • equal       → `verified: true`: the why-line may show the formula;
 *   • not equal   → `verified: false`, `facts.unavailable`: "פירוט לא זמין",
 *                   never a wrong formula;
 *   • no formula  → `verified: null` (duplicate, unordered arrival, date…):
 *                   the plain explanation + the gap, no numbers to check.
 * Display only: the claimed ₪ stays `deltaAmount`. The output `facts` are the
 * `WhyFacts` the web formatter (`lib/components/flags/why.ts`) takes as-is.
 */

export interface EvidenceFacts {
  type: string;
  deltaAmount: number;
  expectedValue: number | null;
  actualValue: number | null;
  toleranceUsed: string | null;
  /** Quantity in the unit the engine compared in (the PO unit when it converted). */
  qtyBilled: number | null;
  billedUnit: string | null;
  poId: string | null;
  poRef: string | null;
  poDate: string | null;
  capped: boolean;
  unavailable: boolean;
}

export interface LineEvidence {
  discrepancyId: string;
  verified: boolean | null;
  facts: EvidenceFacts;
  expectedSource: LeakExpectedSource | null;
  expectedAsOf: string | null;
  deliveryNoteNumber: string | null;
}

const P90_PREFIX = 'actual exceeds historical p90';
const BILLED_OVER_RECEIVED = 'billed quantity exceeds received quantity';
const sameAgora = (a: number, b: number) => toAgorot(a) === toAgorot(b);

/** Billed qty/price normalized to the PO unit, as the engine does (null factor = UNIT_MISMATCH: raw). */
function normalized(l: LeakBreakdownLine): { qty: number | null; price: number | null; unit: string | null } {
  const qty = l.qtyBilled ?? null;
  const price = l.unitPriceBilled ?? null;
  const unit = l.unit ?? null;
  if (qty == null || price == null) return { qty, price, unit };
  const factor = l.unit && l.poUnit && l.unit !== l.poUnit ? unitConversionFactor(l.unit, l.poUnit) : 1;
  if (factor == null) return { qty, price, unit };
  return { qty: qty * factor, price: price / factor, unit: factor === 1 ? unit : (l.poUnit ?? unit) };
}

/** The engine's candidate deltas for this line; null when the type has no checkable formula. */
function candidates(l: LeakBreakdownLine): number[] | null {
  const e = l.expected;
  const a = l.actual;
  const n = normalized(l);
  switch (l.type) {
    case 'PRICE_HIGHER':
    case 'PRICE_LOWER':
      if (e == null || a == null || n.qty == null) return [];
      // PO basis: |actual − expected| × qty; p90 basis: (actual − p90) × qty.
      return (l.toleranceUsed ?? '').startsWith(P90_PREFIX) ? [mulIls(a - e, n.qty)] : [mulIls(Math.abs(a - e), n.qty)];
    case 'QTY_OVER':
      if (e == null || a == null) return [];
      if (l.toleranceUsed === BILLED_OVER_RECEIVED) {
        // billed (actual) − received (expected), at the billed unit price
        return n.price == null ? [] : [mulIls(n.price, a - e)];
      }
      // ordered (expected) vs received (actual), at the PO price
      return l.unitPriceExpected == null ? [] : [mulIls(l.unitPriceExpected, Math.abs(a - e))];
    case 'QTY_SHORT': {
      if (e == null || a == null || l.unitPriceExpected == null) return [];
      const short = e - a;
      // Short units the invoice also bills are counted once, in QTY_OVER (engine 5a/5b).
      const billedNotReceived = n.qty == null ? 0 : Math.max(0, n.qty - a);
      const overlap = Math.min(short, billedNotReceived);
      return [mulIls(l.unitPriceExpected, short), mulIls(l.unitPriceExpected, short - overlap)];
    }
    case 'TOTAL_MISMATCH':
    case 'VAT_MISMATCH':
      if (e == null || a == null) return [];
      return [quantizeIls(Math.abs(a - e))];
    default:
      return null;
  }
}

/** One line's evidence. `capped` = its invoice's leak is capped at the invoice total. */
export function lineEvidence(l: LeakBreakdownLine, capped = false): LineEvidence {
  const c = candidates(l);
  const delta = Math.abs(l.deltaAmount);
  const verified = c == null ? null : c.some((x) => sameAgora(Math.abs(x), delta));
  const n = normalized(l);
  return {
    discrepancyId: l.discrepancyId,
    verified,
    expectedSource: l.expectedSource ?? null,
    expectedAsOf: l.expectedAsOf ?? null,
    deliveryNoteNumber: l.deliveryNoteNumber ?? deliveryNoteNumberIn(l.receiptNote),
    facts: {
      type: l.type,
      deltaAmount: l.deltaAmount,
      expectedValue: l.expected,
      actualValue: l.actual,
      toleranceUsed: l.toleranceUsed ?? null,
      qtyBilled: n.qty,
      billedUnit: n.unit,
      poId: l.poId ?? null,
      poRef: l.poNumber ?? null,
      poDate: l.expectedSource === 'po' ? (l.expectedAsOf ?? null) : null,
      capped: capped && l.countsAsLeak,
      unavailable: verified === false,
    },
  };
}

/** Every line of an invoice; counted lines carry the cap note when Σ|Δ| exceeds the invoice's leak. */
export function invoiceEvidence(inv: LeakBreakdownInvoice): LineEvidence[] {
  const counted = inv.lines.filter((l) => l.countsAsLeak).reduce((s, l) => s + toAgorot(Math.abs(l.deltaAmount)), 0);
  const capped = counted > toAgorot(inv.leakIls);
  return inv.lines.map((l) => lineEvidence(l, capped));
}
