/**
 * G-14 · The METRICS registry: one definition per ₪ metric, so the site, e-mail,
 * WhatsApp, Ask, mobile, the report, the export and the digest all say the same ₪
 * (G-16 asserts it by these ids). Every ₪ procedure returns `{metric, agorot}`
 * additively (slice b wires the procedures; this slice fixes the definitions).
 *
 *  • window    — the time window the ₪ covers, in the restaurant's time zone;
 *  • basis     — what the ₪ is measured on (always integer agorot; |Δ| or a claim amount);
 *  • procedure — the tRPC procedure that serves it today (`owner.priceCreep` is slice b;
 *                `owner.leaks` stays as its alias, COVERAGE add-only);
 *  • scope     — the tenant scope the procedure enforces;
 *  • drill     — where a tap on the number lands; its list total must equal the number.
 */

export const METRIC_IDS = [
  'leak.month',
  'priceCreep.30d',
  'supplierLeak.90d',
  'atRisk.pending',
  'claims.claimed',
  'claims.outstanding',
  'claims.returned',
  'caught.open',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricWindow = 'month' | '30d' | '90d' | 'open' | 'all';
export type MetricBasis =
  | 'capped_abs_delta' // Σ ledger capped_agorot (the one allocator, per-invoice cap)
  | 'abs_delta_uncapped' // Σ |Δ| per line before the invoice cap (price creep)
  | 'invoice_total_incl_vat' // whole invoices held from the leak (pending a PO link / a count)
  | 'claim_amount' // recovery_claims.amount_agorot
  | 'claim_outstanding' // amount − credited of open claims
  | 'claim_credited'; // recovery_claims.credited_agorot
export type MetricScope = 'restaurant' | 'restaurant+supplier' | 'chain';

export interface MetricDef {
  id: MetricId;
  window: MetricWindow;
  basis: MetricBasis;
  procedure: string;
  scope: MetricScope;
  drill: string;
  /** One line for leak-economist sign-off: what the number means. */
  meaning: string;
}

export const METRICS: Readonly<Record<MetricId, MetricDef>> = {
  'leak.month': {
    id: 'leak.month',
    window: 'month',
    basis: 'capped_abs_delta',
    procedure: 'owner.leakHero',
    scope: 'restaurant',
    drill: '/dashboard/leaks',
    meaning: 'The month’s leak: Σ of the ledger’s capped agorot by invoice date; = Σ of the eight money states.',
  },
  'priceCreep.30d': {
    id: 'priceCreep.30d',
    window: '30d',
    basis: 'abs_delta_uncapped',
    procedure: 'owner.priceCreep',
    scope: 'restaurant+supplier',
    drill: '/dashboard/leaks?group=product',
    meaning: 'Prices that went up (מחירים שעלו) over 30 days: a server total over every qualifying row, independent of the list limit.',
  },
  'supplierLeak.90d': {
    id: 'supplierLeak.90d',
    window: '90d',
    basis: 'capped_abs_delta',
    procedure: 'owner.suppliers',
    scope: 'restaurant+supplier',
    drill: '/dashboard/suppliers',
    meaning: 'A supplier’s leak over 90 days, ledger-capped, so the suppliers add up to the leak of the same window.',
  },
  'atRisk.pending': {
    id: 'atRisk.pending',
    window: 'open',
    basis: 'invoice_total_incl_vat',
    procedure: 'owner.leakHero',
    scope: 'restaurant',
    drill: '/dashboard/invoices?pending=1',
    meaning: 'Invoices not checked yet (waiting for a PO link or a count): neutral T4, never added to the leak.',
  },
  'claims.claimed': {
    id: 'claims.claimed',
    window: 'all',
    basis: 'claim_amount',
    procedure: 'recovery.summary',
    scope: 'restaurant',
    drill: '/dashboard/leaks/claims',
    meaning: 'Asked back from suppliers: Σ amount of live claims; = Σ letter lines = the report’s claimed.',
  },
  'claims.outstanding': {
    id: 'claims.outstanding',
    window: 'open',
    basis: 'claim_outstanding',
    procedure: 'recovery.summary',
    scope: 'restaurant',
    drill: '/dashboard/leaks/claims?status=open',
    meaning: 'Still owed by suppliers: amount − credited of claims not closed.',
  },
  'claims.returned': {
    id: 'claims.returned',
    window: 'all',
    basis: 'claim_credited',
    procedure: 'recovery.summary',
    scope: 'restaurant',
    drill: '/dashboard/leaks/claims?status=credited',
    meaning: 'Came back: credited agorot (credit notes and money recovered).',
  },
  'caught.open': {
    id: 'caught.open',
    window: 'month',
    basis: 'capped_abs_delta',
    procedure: 'owner.leakHero',
    scope: 'restaurant',
    drill: '/dashboard/approvals',
    meaning: 'Caught before payment: ledger rows whose detection or decision preceded paid_at (not “status ≠ paid”).',
  },
};

export interface MetricValue {
  metric: MetricId;
  /** Integer agorot. */
  agorot: number;
}

/** The additive `{metric, agorot}` field every ₪ procedure returns. */
export function metricValue(metric: MetricId, agorot: number): MetricValue {
  if (!(metric in METRICS)) throw new Error(`metricValue: unknown metric ${metric}`);
  if (!Number.isSafeInteger(agorot)) throw new Error(`metricValue: ${metric} needs integer agorot, got ${agorot}`);
  return { metric, agorot };
}
