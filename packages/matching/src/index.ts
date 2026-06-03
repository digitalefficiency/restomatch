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
}

export interface PoLineInput {
  id: string;
  productId: string | null;
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

export { runMatch } from './engine';
export { DEFAULT_TOLERANCES, resolveTolerances } from './tolerances';
export {
  reconcileInvoiceToPo,
  type ReconciliationLine,
  type ReconciliationLineStatus,
  type ReconciliationResult as InvoiceReconciliationResult,
  type ReconciliationSummary,
  type PoLineRef,
  type InvoiceLineRef,
} from './reconciliation';
