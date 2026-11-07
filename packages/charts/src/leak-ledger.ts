import { sql, type Database } from '@restomatch/db';
import { lineFilter, viewInvoicesSql, type ViewSpec } from './leak-views';
import {
  DECISION_KEY_SQL,
  MONEY_STATES,
  effectSql,
  isLiveClaim,
  moneyStateOf,
  type ClaimStatus,
  type DecisionKey,
  type Effect,
  type MoneyState,
} from './decisions';

type SQL = ReturnType<typeof sql>;

/**
 * G-14 · The leak ledger: one row per discrepancy that counts toward the leak
 * (LEAK_FILTER) in a period, each with its capped amount in INTEGER AGOROT and
 * exactly one money state. Built on the hero's own CTEs (viewInvoicesSql), so the
 * period, the filters and the counted lines are the hero's by construction.
 *
 * ONE ALLOCATOR. Per invoice the cap is round(total_incl_vat × 100) (the hero's
 * per-invoice cap and syncClaims' cap). Rows draw from it greedily in the order
 *   tier 1 — rows holding a live claim: their persisted `amount_agorot` (≤ |Δ|);
 *   tier 2 — other decided rows (claim / waive effect, no live claim): |Δ|;
 *   tier 3 — undecided rows: only what is left;
 * and inside a tier (created_at, id) — the order of syncClaims and the monthly
 * report's cappedIssues. capped = LEAST(want, GREATEST(0, cap − Σ wants before)).
 * So Σ capped per invoice = LEAST(Σ wants, cap), which equals the hero's
 * LEAST(Σ|Δ|, cap) unless a claim holds less than its |Δ| while cap is still free —
 * that gap is reported as `driftAgorot`, never hidden. Rows are LEAK_FILTER ∩ an effect
 * other than `excluded` (decisions.ts), so MISSING_ON_INVOICE (owner 31.10) never enters;
 * until train-B #211 removes it from LEAK_FILTER too, main's hero still counts it and the
 * difference shows as drift.
 *
 * INTERIMS (removed in slice b):
 *  • paid_at: H-03 adds `invoices.paid_at` (deploy Tue 24.11). It is read
 *    schema-tolerantly as `to_jsonb(i) ->> 'paid_at'`, so this SQL runs before and
 *    after that migration; with no paid_at, a `paid` invoice's `updated_at` stands in.
 *  • basis: G-03 adds `discrepancies.basis` (jsonb). Read the same way, as opaque
 *    jsonb with the local DiscrepancyBasis type; G-14 never writes it.
 */

/** G-15's per-discrepancy basis, as G-14 reads it: opaque, every field optional. */
export interface DiscrepancyBasis {
  source?: 'po' | 'baseline_p90' | 'gr' | 'invoice_total' | 'vat_rate' | string;
  qtyUsed?: number | string | null;
  unitPriceUsed?: number | string | null;
  referencePrice?: number | string | null;
  unitFactor?: number | string | null;
  overlapUnits?: number | string | null;
  threshold?: { pct?: number | null; abs?: number | null; units?: number | null } | null;
  [k: string]: unknown;
}

export interface LeakLedgerRow {
  discrepancyId: string;
  invoiceId: string;
  supplierId: string | null;
  type: string;
  severity: string;
  resolutionStatus: string;
  decisionKey: DecisionKey;
  effect: Effect;
  /** |Δ| in agorot, before any cap. */
  rawAgorot: number;
  /** The row's share of the leak after the one allocator. Σ over the period = the hero. */
  cappedAgorot: number;
  /** 1 live claim · 2 decided · 3 undecided. */
  tier: 1 | 2 | 3;
  invoicePaid: boolean;
  /** ISO; null = not paid. Interim source until H-03 deploys (see the module note). */
  paidAt: string | null;
  /** The detection or the decision came before the payment (or nothing was paid yet). */
  caughtBeforePayment: boolean;
  claimId: string | null;
  claimStatus: ClaimStatus | null;
  claimAmountAgorot: number | null;
  creditedAgorot: number;
  moneyState: MoneyState;
  basis: DiscrepancyBasis | null;
  createdAt: string;
  resolvedAt: string | null;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const int = (v: unknown): number => (v == null ? 0 : Number(v));
const isoOrNull = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/** The interim paid_at of invoice alias `i` (see the module note). */
export const PAID_AT_SQL: SQL = sql`COALESCE(
  NULLIF(to_jsonb(i) ->> 'paid_at', '')::timestamptz,
  CASE WHEN i.status = 'paid' THEN i.updated_at END
)`;

/** The tier rule of decisions.allocationTier, in SQL over the ledger's `x` columns. */
const TIER_SQL: SQL = sql`(CASE WHEN x.live_claim THEN 1 WHEN x.effect = 'undecided' THEN 3 ELSE 2 END)`;

/** The ledger CTEs (`b`, `inv`, `per`, `x`, `led`) for a view. */
export function leakLedgerSql(restaurantId: string, spec: ViewSpec): SQL {
  const LF = lineFilter(restaurantId, spec.filters);
  return sql`${viewInvoicesSql(restaurantId, spec)},
    x AS (
      SELECT
        d.id AS discrepancy_id, inv.id AS invoice_id, inv.supplier_id,
        d.type::text AS type, d.severity::text AS severity, d.resolution_status::text AS resolution_status,
        ${DECISION_KEY_SQL} AS decision_key,
        ${effectSql()} AS effect,
        d.created_at, d.resolved_at,
        round(abs(COALESCE(d.delta_amount, 0)) * 100)::bigint AS raw_agorot,
        round(COALESCE(i.total_incl_vat, 0) * 100)::bigint AS cap_agorot,
        ${PAID_AT_SQL} AS paid_at,
        to_jsonb(d) -> 'basis' AS basis,
        rc.id AS claim_id, rc.status AS claim_status, rc.amount_agorot AS claim_amount,
        COALESCE(rc.credited_agorot, 0) AS credited_agorot,
        (rc.id IS NOT NULL AND NOT (rc.status = 'written_off' AND COALESCE(rc.credited_agorot, 0) = 0)) AS live_claim
      FROM inv
      JOIN invoices i ON i.id = inv.id AND i.restaurant_id = ${restaurantId}
      JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      LEFT JOIN recovery_claims rc ON rc.discrepancy_id = d.id AND rc.restaurant_id = ${restaurantId}
      -- decisions.ts decides what is leak; LEAK_FILTER (main) may still count a type the
      -- owner took out (MISSING_ON_INVOICE until train-B #211): such rows never enter.
      WHERE ${LF} AND ${effectSql()} <> 'excluded'
    ),
    w AS (
      SELECT x.*, ${TIER_SQL} AS tier,
        CASE WHEN x.live_claim THEN LEAST(COALESCE(x.claim_amount, 0), x.raw_agorot) ELSE x.raw_agorot END AS want
      FROM x
    ),
    led AS (
      SELECT w.*,
        LEAST(w.want, GREATEST(0, w.cap_agorot - (SUM(w.want) OVER (
          PARTITION BY w.invoice_id ORDER BY w.tier, w.created_at, w.discrepancy_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) - w.want))) AS capped_agorot
      FROM w
    )`;
}

/** Every counting discrepancy of the period with its capped agorot and money state. */
export async function computeLeakLedger(db: Database, restaurantId: string, spec: ViewSpec): Promise<LeakLedgerRow[]> {
  const res = await db.execute(sql`
    WITH ${leakLedgerSql(restaurantId, spec)}
    SELECT * FROM led ORDER BY invoice_id, tier, created_at, discrepancy_id
  `);
  return rowsOf(res).map(toLedgerRow);
}

function toLedgerRow(r: Row): LeakLedgerRow {
  const effect = String(r.effect) as Effect;
  const claimStatus = (r.claim_status as ClaimStatus | null) ?? null;
  const creditedAgorot = int(r.credited_agorot);
  const paidAt = isoOrNull(r.paid_at);
  const createdAt = isoOrNull(r.created_at)!;
  const resolvedAt = isoOrNull(r.resolved_at);
  const invoicePaid = paidAt != null;
  const tier = int(r.tier) as 1 | 2 | 3;
  // The SQL tier must be the decisions.ts rule (parity; a mismatch is a bug, not data).
  if ((tier === 1) !== isLiveClaim(claimStatus, creditedAgorot)) throw new Error('leak-ledger: tier/claim mismatch');
  return {
    discrepancyId: String(r.discrepancy_id),
    invoiceId: String(r.invoice_id),
    supplierId: r.supplier_id == null ? null : String(r.supplier_id),
    type: String(r.type),
    severity: String(r.severity),
    resolutionStatus: String(r.resolution_status),
    decisionKey: String(r.decision_key) as DecisionKey,
    effect,
    rawAgorot: int(r.raw_agorot),
    cappedAgorot: int(r.capped_agorot),
    tier,
    invoicePaid,
    paidAt,
    caughtBeforePayment: caughtBefore(createdAt, resolvedAt, paidAt),
    claimId: r.claim_id == null ? null : String(r.claim_id),
    claimStatus,
    claimAmountAgorot: r.claim_amount == null ? null : int(r.claim_amount),
    creditedAgorot,
    moneyState: moneyStateOf({ effect, claimStatus, creditedAgorot, invoicePaid }),
    basis: parseBasis(r.basis),
    createdAt,
    resolvedAt,
  };
}

/**
 * "Caught before payment" (approvals-21): the leak was detected, or decided, before
 * the invoice was paid — measured by time, not by today's status (a paid invoice
 * whose gap was caught first is still caught; decision 7 "נתפס is measured at
 * decision time").
 */
export function caughtBefore(createdAt: string, resolvedAt: string | null, paidAt: string | null): boolean {
  if (paidAt == null) return true;
  const paid = Date.parse(paidAt);
  return Date.parse(createdAt) < paid || (resolvedAt != null && Date.parse(resolvedAt) < paid);
}

/** discrepancies.basis as G-14 reads it: an object, or null for anything else. */
export function parseBasis(v: unknown): DiscrepancyBasis | null {
  const o = typeof v === 'string' ? safeJson(v) : v;
  return o != null && typeof o === 'object' && !Array.isArray(o) ? (o as DiscrepancyBasis) : null;
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ───────────────────────── the partition ───────────────────────── */

export interface LeakPartition {
  /** Agorot per money state; every state present (0 when empty). */
  states: Record<MoneyState, number>;
  /** Σ states. */
  totalAgorot: number;
  /** The hero's leak for the same view, in agorot (Σ per invoice LEAST(Σ|Δ|, cap)). */
  heroAgorot: number;
  /** heroAgorot − totalAgorot. 0 = the states add up to the hero to the agora. */
  driftAgorot: number;
  /** Σ capped of rows caught before payment. */
  caughtBeforePaymentAgorot: number;
  rowCount: number;
}

export function emptyStates(): Record<MoneyState, number> {
  return Object.fromEntries(MONEY_STATES.map((s) => [s, 0])) as Record<MoneyState, number>;
}

/** Fold ledger rows into the partition (pure; the hero figure comes from the caller). */
export function partitionOf(rows: readonly LeakLedgerRow[], heroAgorot: number): LeakPartition {
  const states = emptyStates();
  let caught = 0;
  for (const r of rows) {
    states[r.moneyState] += r.cappedAgorot;
    if (r.caughtBeforePayment) caught += r.cappedAgorot;
  }
  const totalAgorot = MONEY_STATES.reduce((s, k) => s + states[k], 0);
  return {
    states,
    totalAgorot,
    heroAgorot,
    driftAgorot: heroAgorot - totalAgorot,
    caughtBeforePaymentAgorot: caught,
    rowCount: rows.length,
  };
}

/** The hero's leak for a view, in agorot, from the very CTEs the hero uses. */
export async function heroLeakAgorot(db: Database, restaurantId: string, spec: ViewSpec): Promise<number> {
  const res = await db.execute(sql`
    WITH ${viewInvoicesSql(restaurantId, spec)}
    SELECT COALESCE(SUM(round(LEAST(raw_leak, total) * 100)), 0)::bigint AS agorot FROM per
  `);
  return int(rowsOf(res)[0]?.agorot);
}

/** The money-state partition of a view's leak, with the hero beside it. */
export async function computeLeakPartition(db: Database, restaurantId: string, spec: ViewSpec): Promise<LeakPartition> {
  const [rows, hero] = await Promise.all([
    computeLeakLedger(db, restaurantId, spec),
    heroLeakAgorot(db, restaurantId, spec),
  ]);
  return partitionOf(rows, hero);
}
