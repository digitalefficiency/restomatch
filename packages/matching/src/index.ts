import type { Tolerances } from '@restomatch/types';

export type DiscrepancyType =
  | 'PRICE_HIGHER'
  | 'PRICE_LOWER'
  | 'QTY_SHORT'
  | 'QTY_OVER'
  | 'UNORDERED_ITEM'
  | 'MISSING_ON_INVOICE'
  | 'UNIT_MISMATCH'
  | 'UNORDERED_ARRIVAL'
  | 'DUPLICATE_INVOICE'
  | 'DATE_ANOMALY'
  | 'VAT_MISMATCH'
  | 'TOTAL_MISMATCH';

export type Severity = 'info' | 'warn' | 'block';
export type MatchStatus = 'clean' | 'minor' | 'major' | 'blocked';

export interface Discrepancy {
  type: DiscrepancyType;
  severity: Severity;
  productId: string | null;
  poLineId?: string | null;
  grLineId?: string | null;
  invoiceLineId?: string | null;
  expected: number | null;
  actual: number | null;
  deltaAmount: number;
  toleranceUsed: string;
  message?: string;
  /**
   * G-15: the calculation behind `deltaAmount` (additive; the engine always
   * sets it). `basisDeltaAmount(basis)` recomputes `deltaAmount` to the agora.
   */
  basis?: DiscrepancyBasis;
}

/** Where the reference side of a discrepancy came from. */
export type BasisSource =
  | 'po' // the purchase order (ordered qty / expected unit price)
  | 'baseline_p90' // the supplier's historical 90th-percentile price
  | 'gr' // the goods receipt (received qty)
  | 'invoice_line' // the invoice line itself (an unordered line's total)
  | 'invoice_total' // the invoice header (total, subtotal)
  | 'vat_rate' // subtotal × VAT rate
  | 'none'; // no ₪ (dates, units)

/**
 * How `deltaAmount` follows from the basis:
 *  • price_x_qty — |unitPriceUsed − referencePrice| × qtyUsed
 *  • unit_x_qty  — unitPriceUsed × qtyUsed
 *  • amount      — actualAmount
 *  • amount_diff — |actualAmount − referenceAmount| (in agorot)
 *  • none        — ₪0
 */
export type BasisFormula = 'price_x_qty' | 'unit_x_qty' | 'amount' | 'amount_diff' | 'none';

export interface DiscrepancyBasis {
  source: BasisSource;
  formula: BasisFormula;
  /** PO ordered qty, in PO units. */
  qtyOrdered: number | null;
  /** GR received qty (summed over partial deliveries), in PO units. */
  qtyReceived: number | null;
  /** Invoice billed qty, unit-normalized to PO units. */
  qtyBilled: number | null;
  /** The units the ₪ is computed on (after any overlap). */
  qtyUsed: number | null;
  /** The unit price multiplied (billed price for price gaps; expected/billed for qty gaps). */
  unitPriceUsed: number | null;
  /** The reference unit price (PO expected or baseline p90). */
  referencePrice: number | null;
  /** Invoice-unit → PO-unit factor (1 when units agree, null when not convertible). */
  unitFactor: number | null;
  /** QTY_SHORT units already counted by the line's QTY_OVER (billed, not received). */
  overlapUnits: number | null;
  /** Billed amount (invoice total, line total, VAT amount, lines sum). */
  actualAmount: number | null;
  /** Reference amount (invoice subtotal, subtotal × VAT rate). */
  referenceAmount: number | null;
  vatRate: number | null;
  threshold: { pct: number | null; abs: number | null; units: number | null };
}

export interface PoLineInput {
  id: string;
  productId: string | null;
  /** Supplier catalog number (מק״ט). Pairing fallback when productId is unresolved. */
  supplierSku?: string | null;
  qtyOrdered: number;
  unit: string;
  unitPriceExpected: number | null;
}

export interface GrLineInput {
  id: string;
  poLineId: string | null;
  productId: string | null;
  qtyReceived: number;
}

export interface InvoiceLineInput {
  id: string;
  productId: string | null;
  /** Supplier catalog number (מק״ט). Pairing fallback when productId is unresolved. */
  supplierSku?: string | null;
  qtyBilled: number;
  unit: string;
  unitPriceBilled: number;
  lineTotal: number;
}

export interface InvoiceHeaderInput {
  invoiceNumber: string;
  invoiceDate: Date;
  supplierId: string;
  totalExclVat: number;
  vatAmount: number;
  totalInclVat: number;
}

export interface BaselineEntry {
  p50: number;
  p90: number;
}

export interface MatchInput {
  invoice: InvoiceHeaderInput;
  poLines: PoLineInput[];
  grLines: GrLineInput[];
  invoiceLines: InvoiceLineInput[];
  vatRate: number;
  tolerances: Tolerances;

  /** Optional: historical price baselines per productId */
  baselines?: Record<string, BaselineEntry>;

  /** Optional: known invoice numbers for the supplier — used for duplicate detection */
  knownInvoiceNumbers?: ReadonlySet<string>;

  /** Optional: expected delivery date for the PO — used for DATE_ANOMALY check */
  expectedDeliveryDate?: Date;
}

export interface MatchOutput {
  status: MatchStatus;
  totalDiscrepancyAmount: number;
  discrepancies: Discrepancy[];
}

export { runMatch, basisDeltaAmount } from './engine';
export { toAgorot, toShekels, quantizeIls, mulIls, sumIls } from './money';
export { DEFAULT_TOLERANCES, resolveTolerances } from './tolerances';
export { unitConversionFactor, areConvertible } from './units';
export {
  reconcileInvoiceToPo,
  type ReconciliationLine,
  type ReconciliationLineStatus,
  type ReconciliationResult as InvoiceReconciliationResult,
  type ReconciliationSummary,
  type PoLineRef,
  type InvoiceLineRef,
} from './reconciliation';
