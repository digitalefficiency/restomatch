/**
 * Is this document a consolidated invoice (חשבונית מרכזת)? (Owner decision 31.10)
 *
 * A מרכזת bills a period's delivery notes (ת.מ.) in one invoice. Matched like an
 * ordinary invoice it is held against at most ONE purchase order, and everything
 * the other deliveries brought looks like a leak. So the downstream consolidated
 * cross-match must see it, and only it, as consolidated.
 *
 * CONSERVATIVE by design: a regular invoice wrongly called consolidated would
 * skip the per-PO match, so the bar is a printed fact, not the model's say-so:
 *   - a list of at least two distinct ת.מ. numbers, or
 *   - the model reads a מרכזת AND a billing period is printed.
 * A regular invoice citing one ת.מ. ("לפי ת.מ. 1234") stays regular.
 */
import type { DeliveryNoteRef, DocumentKind } from './providers/invoiceSchema';

export type Consolidation = 'regular' | 'consolidated';

export type ConsolidationBasis =
  /** ≥ 2 distinct delivery notes listed. */
  | 'delivery_note_list'
  /** Declared a מרכזת and prints a billing period. */
  | 'declared_with_period'
  | 'none';

export interface BillingPeriod {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
}

export interface ConsolidationInput {
  documentKind?: DocumentKind;
  deliveryNotes?: DeliveryNoteRef[];
  periodStart?: string;
  periodEnd?: string;
}

export interface ConsolidationResult {
  consolidation: Consolidation;
  basis: ConsolidationBasis;
  billingPeriod?: BillingPeriod;
}

/** The printed billing period, when both ends are there and in order. */
export function billingPeriodOf(inv: Pick<ConsolidationInput, 'periodStart' | 'periodEnd'>): BillingPeriod | undefined {
  const { periodStart: from, periodEnd: to } = inv;
  return from && to && from <= to ? { from, to } : undefined;
}

export function classifyConsolidation(inv: ConsolidationInput): ConsolidationResult {
  const billingPeriod = billingPeriodOf(inv);
  const notes = new Set((inv.deliveryNotes ?? []).map((n) => n.number).filter((n) => n !== ''));
  const period = billingPeriod ? { billingPeriod } : {};
  if (notes.size >= 2) return { consolidation: 'consolidated', basis: 'delivery_note_list', ...period };
  if (inv.documentKind === 'consolidated' && billingPeriod) {
    return { consolidation: 'consolidated', basis: 'declared_with_period', ...period };
  }
  return { consolidation: 'regular', basis: 'none', ...period };
}

/**
 * The `ocr_payload.raw` fields the consolidated cross-match reads
 * (packages/api/src/match/consolidated.ts → readConsolidatedRaw): kind,
 * periodStart/periodEnd (YYYY-MM-DD) and deliveryNotes[].number (digits).
 * Null for a regular invoice — then nothing is written and the matcher treats
 * it as an ordinary invoice.
 */
export interface ConsolidatedRawFields {
  kind: 'consolidated';
  periodStart?: string;
  periodEnd?: string;
  deliveryNotes: DeliveryNoteRef[];
}

export function consolidatedRawOf(
  inv: ConsolidationInput & { consolidation?: Consolidation },
): ConsolidatedRawFields | null {
  const consolidation = inv.consolidation ?? classifyConsolidation(inv).consolidation;
  if (consolidation !== 'consolidated') return null;
  const period = billingPeriodOf(inv);
  return {
    kind: 'consolidated',
    ...(period ? { periodStart: period.from, periodEnd: period.to } : {}),
    deliveryNotes: (inv.deliveryNotes ?? []).filter((n) => n.number !== ''),
  };
}
