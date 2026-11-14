import { sql, type Database } from '@restomatch/db';
import { invoiceLeakStateCte, LEAK_FILTER, monthInvoicesCte, scanAwaitingCountSql } from '@restomatch/charts';
import type { SQL } from 'drizzle-orm';
import { discrepancyDecidableSql, duplicateHoldingSql } from '../lifecycle/predicates';

/**
 * THE canonical single state of an invoice (G-05, exec-desktop-02). Every
 * screen that says what an invoice "is" reads this, never `invoices.status`
 * alone: OCR and imports set matched-like statuses before any match ran, and a
 * `disputed` row may already have every finding decided.
 *
 * Composed from W2-09a's per-invoice CTEs (`monthInvoicesCte` /
 * `invoiceLeakStateCte`, the hero's own ₪ rules) plus `match_runs` and the
 * findings on them. It reads; it never moves ₪ and never writes.
 *
 * First match wins:
 *   paid           invoices.status = paid (a person's payment decision)
 *   awaiting_count no match run yet and the OCR held it for its receipt's count (#94)
 *   in_ocr         still in OCR (ocr_pending)
 *   held_duplicate a live duplicate finding (open/escalated/accepted): "don't pay this copy"
 *   awaiting_link  no PO link yet: no match run, or an open UNORDERED_ARRIVAL (T4)
 *   flagged_open   an undecided (open/escalated) real leak finding (T2)
 *   claim_open     an accepted real finding: a credit to ask for
 *   approved       approved for payment, nothing left open
 *   clean          checked, nothing to do
 *
 * Pay-run parity (routers/payRun.ts, unpaid and not in OCR): pay = clean |
 * approved; claim = claim_open; hold = awaiting_count | held_duplicate |
 * flagged_open; link = awaiting_link. Hero parity: awaitingCount* and
 * pendingLink* use the same flags (see invoice-state.test.ts).
 */

export const INVOICE_STATES = [
  'in_ocr',
  'awaiting_count',
  'awaiting_link',
  'clean',
  'flagged_open',
  'claim_open',
  'held_duplicate',
  'approved',
  'paid',
] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export interface InvoiceStateRow {
  invoiceId: string;
  state: InvoiceState;
  /** invoices.status as stored (for display/debug only — never branch on it). */
  status: string;
  totalInclVat: number;
  /** The hero's per-invoice leak (capped at the invoice total), ₪. */
  leakIls: number;
  /** The flags the state is derived from. */
  checked: boolean;
  pendingLink: boolean;
  awaitingCount: boolean;
  duplicate: boolean;
  openFinding: boolean;
  acceptedFinding: boolean;
}

/**
 * SQL: defines `st` from a `per` CTE (W2-09a's shape: id, status, total,
 * matched, raw_leak, pending_link) — one row per invoice with its state and
 * flags. Use as `WITH ${monthInvoicesCte(…)}, ${invoiceStateCte(rid)} SELECT … FROM st`.
 */
export function invoiceStateCte(restaurantId: string): SQL {
  const finding = (cond: SQL) => sql`EXISTS (
    SELECT 1 FROM match_runs smr
    JOIN discrepancies d ON d.match_run_id = smr.id AND d.restaurant_id = ${restaurantId}
    WHERE smr.invoice_id = per.id AND smr.restaurant_id = ${restaurantId} AND ${cond}
  )`;
  return sql`
    st0 AS (
      SELECT
        per.id,
        per.status::text AS status,
        per.total,
        LEAST(per.raw_leak, per.total) AS leak,
        COALESCE(per.matched, false) AS checked,
        COALESCE(per.pending_link, false) AS pending_link,
        (NOT COALESCE(per.matched, false)) AND ${scanAwaitingCountSql(restaurantId, sql`si`)} AS awaiting_count,
        ${finding(sql`d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block') AND ${duplicateHoldingSql(sql`d.resolution_status`)}`)} AS duplicate,
        ${finding(sql`${LEAK_FILTER} AND ${discrepancyDecidableSql(sql`d.resolution_status`)} AND ABS(d.delta_amount) > 0`)} AS open_finding,
        ${finding(sql`${LEAK_FILTER} AND d.resolution_status = 'accepted' AND d.type <> 'DUPLICATE_INVOICE' AND ABS(d.delta_amount) > 0`)} AS accepted_finding
      FROM per
      JOIN invoices si ON si.id = per.id AND si.restaurant_id = ${restaurantId}
    ),
    st AS (
      SELECT st0.*,
        CASE
          WHEN status = 'paid' THEN 'paid'
          WHEN awaiting_count THEN 'awaiting_count'
          WHEN status = 'ocr_pending' THEN 'in_ocr'
          WHEN duplicate THEN 'held_duplicate'
          WHEN pending_link THEN 'awaiting_link'
          WHEN open_finding THEN 'flagged_open'
          WHEN accepted_finding THEN 'claim_open'
          WHEN status = 'approved' THEN 'approved'
          ELSE 'clean'
        END AS state
      FROM st0
    )`;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

function rowOf(r: Row): InvoiceStateRow {
  return {
    invoiceId: String(r.id),
    state: String(r.state) as InvoiceState,
    status: String(r.status),
    totalInclVat: money(r.total),
    leakIls: money(r.leak),
    checked: r.checked === true,
    pendingLink: r.pending_link === true,
    awaitingCount: r.awaiting_count === true,
    duplicate: r.duplicate === true,
    openFinding: r.open_finding === true,
    acceptedFinding: r.accepted_finding === true,
  };
}

/** Every invoice of the hero's month (same tz and date rule), with its state. */
export async function invoiceStatesForMonth(
  db: Database,
  restaurantId: string,
  options: { now?: Date; monthOffset?: number } = {},
): Promise<InvoiceStateRow[]> {
  const res = await db.execute(sql`
    WITH ${monthInvoicesCte(restaurantId, options.now ?? new Date(), options.monthOffset ?? 0)},
    ${invoiceStateCte(restaurantId)}
    SELECT * FROM st ORDER BY id
  `);
  return rowsOf(res).map(rowOf);
}

/** The state of the given invoices, whatever their dates. Foreign or unknown ids are absent. */
export async function invoiceStatesOf(
  db: Database,
  restaurantId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, InvoiceStateRow>> {
  const ids = [...new Set(invoiceIds)];
  const out = new Map<string, InvoiceStateRow>();
  for (let at = 0; at < ids.length; at += 500) {
    const chunk = ids.slice(at, at + 500);
    const res = await db.execute(sql`
      WITH ${invoiceLeakStateCte(restaurantId, chunk)},
      ${invoiceStateCte(restaurantId)}
      SELECT * FROM st
    `);
    for (const r of rowsOf(res)) out.set(String(r.id), rowOf(r));
  }
  return out;
}

export async function invoiceStateOf(db: Database, restaurantId: string, invoiceId: string): Promise<InvoiceStateRow | null> {
  return (await invoiceStatesOf(db, restaurantId, [invoiceId])).get(invoiceId) ?? null;
}

/** Count per state (every state present, zeros included). */
export function countStates(rows: readonly InvoiceStateRow[]): Record<InvoiceState, number> {
  const out = Object.fromEntries(INVOICE_STATES.map((s) => [s, 0])) as Record<InvoiceState, number>;
  for (const r of rows) out[r.state] += 1;
  return out;
}
