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
 *   tier 2 — other decided rows (claim / waive effect, no live claim): |Δ|, claims before waivers;
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
 *  • paid (metrics.PAID_SOURCE): the H-04 payment ledger when present and allocated
 *    (detected at run time), else H-03's `invoices.paid_at` read schema-tolerantly as
 *    `to_jsonb(i) ->> 'paid_at'`, else `updated_at` of a `paid` invoice. Compared by
 *    the restaurant's calendar day (caughtBefore).
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
  /**
   * The gap was FOUND (detected or decided) on a day before the pay day, or nothing is paid
   * yet. It is not a saving: waived and undecided rows count too (G-14 acceptance 3).
   */
  caughtBeforePayment: boolean;
  /** Where paidAt came from; 'interim' = the updated_at estimate until H-03/H-04 (label it). */
  paidSource: PaidSource;
  /**
   * Part of cappedAgorot that a closed claim never got back (written off with part credited, or
   * recovered short — shortfallAgorot): the row's state covers what came back only; this
   * remainder is reported as `waived`.
   */
  writtenOffAgorot: number;
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

/**
 * The summary/interim paid_at of invoice alias `i`: H-03's `invoices.paid_at` (read
 * schema-tolerantly), else `updated_at` of a `paid` invoice (today).
 */
export const PAID_AT_SQL: SQL = sql`COALESCE(
  NULLIF(to_jsonb(i) ->> 'paid_at', '')::timestamptz,
  CASE WHEN i.status = 'paid' THEN i.updated_at END
)`;

/**
 * paid_at per metrics.PAID_SOURCE. With the H-04 payment ledger present (`hasLedger`) and
 * allocations for the invoice, the ledger is the truth: the Israel day (`paid_on`, as
 * midnight in the restaurant's time zone) of the payment whose cumulative allocations
 * first cover the invoice total; allocated but not covered = not paid yet. Without
 * allocations: PAID_AT_SQL. `tz` is the restaurant time zone expression.
 */
/** Where a row's paid_at came from (metrics.PAID_SOURCE order); 'interim' = the updated_at estimate. */
export type PaidSource = 'ledger' | 'paid_at' | 'interim' | null;

/** SQL for the PaidSource of invoice alias `i` (mirrors paidAtSql's chain). */
export function paidSourceSql(restaurantId: string, hasLedger: boolean): SQL {
  const ledger = hasLedger
    ? sql`WHEN EXISTS (
        SELECT 1 FROM payment_invoices pa WHERE pa.invoice_id = i.id AND pa.restaurant_id = ${restaurantId}
      ) THEN 'ledger'`
    : sql``;
  return sql`(CASE ${ledger}
    WHEN NULLIF(to_jsonb(i) ->> 'paid_at', '') IS NOT NULL THEN 'paid_at'
    WHEN i.status = 'paid' THEN 'interim'
    ELSE NULL END)`;
}

export function paidAtSql(restaurantId: string, hasLedger: boolean, tz: SQL, hasDeductions = false): SQL {
  if (!hasLedger) return PAID_AT_SQL;
  // What the payments must cover: the invoice total less any short-pay deductions (offsets).
  const deducted = hasDeductions
    ? sql`COALESCE((SELECT SUM(pd.amount_agorot) FROM payment_deductions pd
        WHERE pd.invoice_id = i.id AND pd.restaurant_id = ${restaurantId}), 0)`
    : sql`0`;
  return sql`(CASE
    WHEN EXISTS (
      SELECT 1 FROM payment_invoices pa WHERE pa.invoice_id = i.id AND pa.restaurant_id = ${restaurantId}
    ) THEN COALESCE((
      SELECT MIN(c.paid_on)::timestamp AT TIME ZONE ${tz}
      FROM (
        SELECT p.paid_on, SUM(pa.amount_agorot) OVER (
          ORDER BY p.paid_on, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cum
        FROM payment_invoices pa
        JOIN payments p ON p.id = pa.payment_id AND p.restaurant_id = ${restaurantId}
        WHERE pa.invoice_id = i.id AND pa.restaurant_id = ${restaurantId}
      ) c
      WHERE c.cum >= round(COALESCE(i.total_incl_vat, 0) * 100) - ${deducted}
    ),
    -- Allocated but short of the total (a discount, rounding): the writer's paid_at summary decides.
    NULLIF(to_jsonb(i) ->> 'paid_at', '')::timestamptz)
    ELSE ${PAID_AT_SQL}
  END)`;
}

/** Is the H-04 payment ledger (`payments` + `payment_invoices`) in this database? */
export async function hasPaymentLedger(db: Database): Promise<boolean> {
  return (await paymentTables(db)).ledger;
}

/** Which H-04 payment tables exist in this database (checked at run time). */
export async function paymentTables(db: Database): Promise<{ ledger: boolean; deductions: boolean }> {
  const res = await db.execute(sql`SELECT
    to_regclass('public.payment_invoices') IS NOT NULL AND to_regclass('public.payments') IS NOT NULL AS ledger,
    to_regclass('public.payment_deductions') IS NOT NULL AS deductions`);
  const r = rowsOf(res)[0] ?? {};
  return { ledger: Boolean(r.ledger), deductions: Boolean(r.deductions) };
}

/** The tier rule of decisions.allocationTier, in SQL over the ledger's `x` columns. */
const TIER_SQL: SQL = sql`(CASE WHEN x.live_claim THEN 1 WHEN x.effect = 'undecided' THEN 3 ELSE 2 END)`;
/** A live claim on recovery_claims alias `rc` (decisions.isLiveClaim): any claim but a written-off one with ₪0 back. */
const LIVE_CLAIM_SQL: SQL = sql`(rc.id IS NOT NULL AND NOT (rc.status = 'written_off' AND COALESCE(rc.credited_agorot, 0) = 0))`;
/** What a row asks of the cap: a live claim its persisted amount (≤ |Δ|), any other row |Δ|. */
const WANT_SQL: SQL = sql`(CASE WHEN x.live_claim THEN LEAST(COALESCE(x.claim_amount, 0), x.raw_agorot) ELSE x.raw_agorot END)`;
/**
 * THE allocator: a row's capped agorot over `w` (tier, want, cap_agorot per invoice). Greedy in
 * (tier, claims before waivers, created_at, id). The ledger and every per-line ₪ use this one
 * expression (leakLedgerSql, invoiceAllocationSql), so no screen splits a cap its own way.
 */
const CAPPED_SQL: SQL = sql`LEAST(w.want, GREATEST(0, w.cap_agorot - (SUM(w.want) OVER (
  PARTITION BY w.invoice_id ORDER BY w.tier, (w.effect = 'waive'), w.created_at, w.discrepancy_id
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
) - w.want)))`;

/**
 * The ledger allocation of every counting row of the given invoices, whatever their dates
 * (the per-invoice twin of leakLedgerSql, no period window): a SELECT of discrepancy_id, tier,
 * effect, claim_status, claim_amount, credited_agorot, live_claim, capped_agorot. `counts` is
 * the line filter (LEAK_FILTER, or a view's lineFilter — the same rows the ledger of that view
 * allocates). Rows outside the ledger (not counting, or effect `excluded`) are absent.
 * `invoiceIds` must be non-empty.
 */
export function invoiceAllocationSql(restaurantId: string, invoiceIds: readonly string[], counts: SQL): SQL {
  if (invoiceIds.length === 0) throw new Error('invoiceAllocationSql: invoiceIds is empty');
  return sql`SELECT w.discrepancy_id, w.tier, w.effect, w.claim_status, w.claim_amount, w.credited_agorot,
      w.live_claim, ${CAPPED_SQL} AS capped_agorot
    FROM (
      SELECT x.*, ${TIER_SQL} AS tier, ${WANT_SQL} AS want
      FROM (
        SELECT d.id AS discrepancy_id, mr.invoice_id, ${effectSql()} AS effect, d.created_at,
          round(abs(COALESCE(d.delta_amount, 0)) * 100)::bigint AS raw_agorot,
          round(COALESCE(i.total_incl_vat, 0) * 100)::bigint AS cap_agorot,
          rc.status AS claim_status, rc.amount_agorot AS claim_amount,
          COALESCE(rc.credited_agorot, 0) AS credited_agorot,
          ${LIVE_CLAIM_SQL} AS live_claim
        FROM invoices i
        JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
        JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
        LEFT JOIN recovery_claims rc ON rc.discrepancy_id = d.id AND rc.restaurant_id = ${restaurantId}
        WHERE i.restaurant_id = ${restaurantId}
          AND i.id IN (${sql.join(invoiceIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND ${counts} AND ${effectSql()} <> 'excluded'
      ) x
    ) w`;
}

/** The ledger CTEs (`b`, `inv`, `per`, `x`, `led`) for a view. */
export function leakLedgerSql(
  restaurantId: string,
  spec: ViewSpec,
  opts: { hasLedger?: boolean; hasDeductions?: boolean } = {},
): SQL {
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
        ${paidAtSql(restaurantId, opts.hasLedger ?? false, sql`bt.tz`, opts.hasDeductions ?? false)} AS paid_at,
        ${paidSourceSql(restaurantId, opts.hasLedger ?? false)} AS paid_source,
        bt.tz AS tz,
        to_jsonb(d) -> 'basis' AS basis,
        rc.id AS claim_id, rc.status AS claim_status, rc.amount_agorot AS claim_amount,
        COALESCE(rc.credited_agorot, 0) AS credited_agorot,
        ${LIVE_CLAIM_SQL} AS live_claim
      FROM inv
      CROSS JOIN (SELECT tz FROM b) bt
      JOIN invoices i ON i.id = inv.id AND i.restaurant_id = ${restaurantId}
      JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      LEFT JOIN recovery_claims rc ON rc.discrepancy_id = d.id AND rc.restaurant_id = ${restaurantId}
      -- decisions.ts decides what is leak; LEAK_FILTER (main) may still count a type the
      -- owner took out (MISSING_ON_INVOICE until train-B #211): such rows never enter.
      WHERE ${LF} AND ${effectSql()} <> 'excluded'
    ),
    w AS (
      SELECT x.*, ${TIER_SQL} AS tier, ${WANT_SQL} AS want
      FROM x
    ),
    led AS (
      SELECT w.*, ${CAPPED_SQL} AS capped_agorot
      FROM w
    )`;
}

/** Every counting discrepancy of the period with its capped agorot and money state. */
export async function computeLeakLedger(db: Database, restaurantId: string, spec: ViewSpec): Promise<LeakLedgerRow[]> {
  const t = await paymentTables(db);
  const res = await db.execute(sql`
    WITH ${leakLedgerSql(restaurantId, spec, { hasLedger: t.ledger, hasDeductions: t.deductions })}
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
    caughtBeforePayment: caughtBefore(createdAt, resolvedAt, paidAt, String(r.tz ?? ISRAEL_TZ)),
    paidSource: (r.paid_source as PaidSource) ?? null,
    writtenOffAgorot: shortfallAgorot(claimStatus, creditedAgorot, int(r.capped_agorot)),
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
 * The part of a closed claim's capped ₪ that never came back, reported as waived (G-14 line 16):
 * a written-off claim with part credited, and — its twin — a claim closed as `recovered` short of
 * its amount (recovery books that shortfall as written off; G-14 Q3 R4-1). Main counted a short
 * recovery as fully recovered. An open claim, or a written-off one with ₪0 back (not live), has none.
 */
export function shortfallAgorot(status: ClaimStatus | null, creditedAgorot: number, cappedAgorot: number): number {
  if (status === 'recovered' || (status === 'written_off' && creditedAgorot > 0)) {
    return Math.max(0, cappedAgorot - creditedAgorot);
  }
  return 0;
}

export const ISRAEL_TZ = 'Asia/Jerusalem';

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function dayIn(isoInstant: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(isoInstant),
  );
}

/**
 * "Caught before payment" (approvals-21; owner/H-03 7.11): the leak was detected, or
 * decided, on a calendar day (restaurant time zone, Israel by default) BEFORE the pay
 * day — not by today's status. Same day as the payment = not caught (paid_at is the
 * business pay date, stored as midnight of that day). Nothing paid yet = caught.
 */
export function caughtBefore(
  createdAt: string,
  resolvedAt: string | null,
  paidAt: string | null,
  tz: string = ISRAEL_TZ,
): boolean {
  if (paidAt == null) return true;
  const payDay = dayIn(paidAt, tz);
  return dayIn(createdAt, tz) < payDay || (resolvedAt != null && dayIn(resolvedAt, tz) < payDay);
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
  /** Σ over invoices of |hero − ledger| — drift that cancels across invoices still shows here. */
  absDriftAgorot: number;
  /** Invoices whose ledger ≠ their hero share. */
  driftInvoiceCount: number;
  /** Σ capped of rows found before payment (not a saving; see LeakLedgerRow.caughtBeforePayment). */
  caughtBeforePaymentAgorot: number;
  /** Part of caughtBeforePaymentAgorot whose pay day is the interim updated_at estimate. */
  caughtOnInterimPaidAgorot: number;
  rowCount: number;
}

export function emptyStates(): Record<MoneyState, number> {
  return Object.fromEntries(MONEY_STATES.map((s) => [s, 0])) as Record<MoneyState, number>;
}

/**
 * Fold ledger rows into the partition (pure). `hero` is the view's hero in agorot, or the
 * hero per invoice (invoiceId → agorot), which also gives per-invoice drift.
 */
export function partitionOf(rows: readonly LeakLedgerRow[], hero: number | ReadonlyMap<string, number>): LeakPartition {
  const heroAgorot = typeof hero === 'number' ? hero : [...hero.values()].reduce((a, b) => a + b, 0);
  const states = emptyStates();
  let caught = 0;
  let caughtInterim = 0;
  for (const r of rows) {
    // A written-off claim with part credited: credited for what came back, waived for the rest.
    states[r.moneyState] += r.cappedAgorot - r.writtenOffAgorot;
    states.waived += r.writtenOffAgorot;
    if (r.caughtBeforePayment) {
      caught += r.cappedAgorot;
      if (r.paidSource === 'interim') caughtInterim += r.cappedAgorot;
    }
  }
  const totalAgorot = MONEY_STATES.reduce((s, k) => s + states[k], 0);
  return {
    states,
    totalAgorot,
    heroAgorot,
    driftAgorot: heroAgorot - totalAgorot,
    ...perInvoiceDrift(rows, hero, heroAgorot - totalAgorot),
    caughtBeforePaymentAgorot: caught,
    caughtOnInterimPaidAgorot: caughtInterim,
    rowCount: rows.length,
  };
}

function perInvoiceDrift(
  rows: readonly LeakLedgerRow[],
  hero: number | ReadonlyMap<string, number>,
  net: number,
): { absDriftAgorot: number; driftInvoiceCount: number } {
  if (typeof hero === 'number') return { absDriftAgorot: Math.abs(net), driftInvoiceCount: net === 0 ? 0 : 1 };
  const led = new Map<string, number>();
  for (const r of rows) led.set(r.invoiceId, (led.get(r.invoiceId) ?? 0) + r.cappedAgorot);
  let abs = 0;
  let count = 0;
  for (const id of new Set([...hero.keys(), ...led.keys()])) {
    const d = (hero.get(id) ?? 0) - (led.get(id) ?? 0);
    if (d !== 0) {
      abs += Math.abs(d);
      count += 1;
    }
  }
  return { absDriftAgorot: abs, driftInvoiceCount: count };
}

/** The hero's leak per invoice of a view, in agorot, from the very CTEs the hero uses. */
export async function heroLeakByInvoice(db: Database, restaurantId: string, spec: ViewSpec): Promise<Map<string, number>> {
  const res = await db.execute(sql`
    WITH ${viewInvoicesSql(restaurantId, spec)}
    SELECT id, round(LEAST(raw_leak, total) * 100)::bigint AS agorot FROM per
  `);
  const out = new Map<string, number>();
  for (const r of rowsOf(res)) if (int(r.agorot) !== 0) out.set(String(r.id), int(r.agorot));
  return out;
}

/** The hero's leak for a view, in agorot. */
export async function heroLeakAgorot(db: Database, restaurantId: string, spec: ViewSpec): Promise<number> {
  return [...(await heroLeakByInvoice(db, restaurantId, spec)).values()].reduce((a, b) => a + b, 0);
}

/** The money-state partition of a view's leak, with the hero beside it. */
export async function computeLeakPartition(db: Database, restaurantId: string, spec: ViewSpec): Promise<LeakPartition> {
  const [rows, hero] = await Promise.all([
    computeLeakLedger(db, restaurantId, spec),
    heroLeakByInvoice(db, restaurantId, spec),
  ]);
  return partitionOf(rows, hero);
}

/** The money states that are "claimed" (accepted for a claim, in any stage): to_offset … recovered. */
export const CLAIM_STATES = ['to_offset', 'to_send', 'requested', 'disputed', 'credited', 'recovered'] as const;

/**
 * G-14 Q3: "claimed" in agorot = Σ of the claim money states. THE one basis for every
 * "claimed / accepted for a claim" figure (hero.recoveredIls, chain, leak report, monthly).
 */
export function claimedAgorotOf(p: Pick<LeakPartition, 'states'>): number {
  return CLAIM_STATES.reduce((a, s) => a + p.states[s], 0);
}
