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

export interface DiscrepancyResult {
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
}

export interface MatchInput {
  poLines: Array<{
    id: string;
    productId: string | null;
    qtyOrdered: number;
    unit: string;
    unitPriceExpected: number | null;
  }>;
  grLines: Array<{
    id: string;
    poLineId: string | null;
    productId: string | null;
    qtyReceived: number;
  }>;
  invoiceLines: Array<{
    id: string;
    productId: string | null;
    qtyBilled: number;
    unit: string;
    unitPriceBilled: number;
    lineTotal: number;
  }>;
  invoiceTotal?: number;
  vatAmount?: number;
  vatRate: number;
  tolerances: Tolerances;
}

export interface MatchOutput {
  status: 'clean' | 'minor' | 'major' | 'blocked';
  totalDiscrepancyAmount: number;
  discrepancies: DiscrepancyResult[];
}

export function runMatch(_input: MatchInput): MatchOutput {
  throw new Error(
    'runMatch not yet implemented — implement per plan section 5.2 (3-way matching logic).',
  );
}
