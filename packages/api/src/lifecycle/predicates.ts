import { sql } from '@restomatch/db';
import type { SQL } from 'drizzle-orm';
import type { InvoiceStatus, ResolutionStatus } from './machines';

/**
 * Named lifecycle predicates (G-05). Two SEPARATE invoice predicates — never one
 * "settled" set — because they answer different questions:
 *
 *   - INVOICE_REMATCH_LOCKED: a person took a payment decision; a re-match must
 *     not move the invoice (match/persist.ts). `disputed` is NOT locked.
 *   - INVOICE_CHECKED: a match has actually run on the invoice. This is an
 *     EXISTS over `match_runs`, never `status = 'matched'`: OCR and imports set
 *     matched-like states before any match ran, and a `disputed`, `approved` or
 *     `paid` invoice is checked too.
 */

export const INVOICE_REMATCH_LOCKED = ['approved', 'paid'] as const satisfies readonly InvoiceStatus[];

export function isInvoiceRematchLocked(status: InvoiceStatus | string): boolean {
  return (INVOICE_REMATCH_LOCKED as readonly string[]).includes(status);
}

/** SQL: `<statusExpr> = ANY('{approved,paid}')`. */
export function invoiceRematchLockedSql(statusExpr: SQL | unknown): SQL {
  return sql`${statusExpr}::text = ANY(${sql.raw(`ARRAY[${INVOICE_REMATCH_LOCKED.map((s) => `'${s}'`).join(',')}]`)})`;
}

/**
 * SQL: a match has run on the invoice. `invoiceIdExpr` is the invoice id column
 * or expression (e.g. `invoices.id`, or sql`i.id`); `restaurantIdExpr` keeps the
 * subquery tenant-scoped (RLS also scopes it).
 */
export function invoiceCheckedSql(invoiceIdExpr: SQL | unknown, restaurantIdExpr: SQL | unknown): SQL {
  return sql`EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = ${invoiceIdExpr} AND mr.restaurant_id = ${restaurantIdExpr})`;
}
export const INVOICE_CHECKED = invoiceCheckedSql;

/** A discrepancy still waiting for a decision (decisions are taken only from these). */
export const DISCREPANCY_DECIDABLE = ['open', 'escalated'] as const satisfies readonly ResolutionStatus[];

export function isDiscrepancyDecidable(status: ResolutionStatus | string): boolean {
  return (DISCREPANCY_DECIDABLE as readonly string[]).includes(status);
}

/** SQL: `<statusExpr> IN ('open','escalated')`. */
export function discrepancyDecidableSql(statusExpr: SQL | unknown): SQL {
  return sql`${statusExpr}::text = ANY(${sql.raw(`ARRAY[${DISCREPANCY_DECIDABLE.map((s) => `'${s}'`).join(',')}]`)})`;
}

/**
 * A duplicate-invoice finding that still holds the copy (pay-run "don't pay
 * this copy"): not waived. Same set as routers/payRun.ts CLAIMABLE_DUP.
 */
export const DUPLICATE_HOLDING = ['open', 'escalated', 'accepted'] as const satisfies readonly ResolutionStatus[];

/** SQL: `<statusExpr> IN ('open','escalated','accepted')`. */
export function duplicateHoldingSql(statusExpr: SQL | unknown): SQL {
  return sql`${statusExpr}::text = ANY(${sql.raw(`ARRAY[${DUPLICATE_HOLDING.map((s) => `'${s}'`).join(',')}]`)})`;
}

// ── Named sets for the train-C migrations (11.11) ─────────────────────────
// Each replaces a literal list in its owner's file; the ratchet in
// lifecycle-predicates.test.ts drops that file's entry once it switches.

/** SQL: `<statusExpr> = ANY(<values>)` for any named set below (values are fixed literals, never input). */
export function statusInSql(statusExpr: SQL | unknown, values: readonly string[]): SQL {
  return sql`${statusExpr}::text = ANY(${sql.raw(`ARRAY[${values.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`;
}

/**
 * Decided as a claim: the claimable ₪ after a decision (lib/claims
 * CLAIMABLE_DECIDED_STATUSES; the hero's "recovered" filter).
 */
export const DISCREPANCY_CLAIMED = ['accepted', 'resolved'] as const satisfies readonly ResolutionStatus[];
/** Undecided or decided-as-claim: what a claim letter / the pay run may count (lib/claims CLAIMABLE_STATUSES). */
export const DISCREPANCY_CLAIMABLE = [...DISCREPANCY_DECIDABLE, ...DISCREPANCY_CLAIMED] as const;

/**
 * Still in intake: OCR not done, or read but never matched (routers/close
 * UNCHECKED, routers/receiving intake list). Status-level only — "has a match
 * run" is INVOICE_CHECKED.
 */
export const INVOICE_INTAKE = ['ocr_pending', 'parsed'] as const satisfies readonly InvoiceStatus[];

/**
 * What OCR built and nobody decided yet, so a re-read may replace it
 * (routers/receiving re-read guard; the reocr edge's from-set is a subset).
 */
export const INVOICE_REREADABLE = ['parsed', 'matched', 'disputed'] as const satisfies readonly InvoiceStatus[];

/**
 * A consolidated invoice past review: it covers its delivery notes; before
 * that it is pending (T4). routers/close SETTLED, match/consolidated,
 * ledger/coverage. This is the consolidated-coverage rule only — it is NOT a
 * general "settled" predicate (see INVOICE_REMATCH_LOCKED / INVOICE_CHECKED).
 */
export const CONSOLIDATED_COVERS_NOTES = ['matched', 'approved', 'paid'] as const satisfies readonly InvoiceStatus[];

/**
 * Out of intake (status-level): exports/period, payRun/preflight CHECKED. For
 * "a match actually ran" use INVOICE_CHECKED (EXISTS match_runs).
 */
export const INVOICE_PAST_INTAKE = ['matched', 'disputed', 'approved', 'paid'] as const satisfies readonly InvoiceStatus[];

/**
 * Unpaid and out of OCR: the pay run's candidate list (replaces
 * `status NOT IN ('paid','ocr_pending')` in payRun/procedures, preflightData).
 */
export const INVOICE_PAY_RUN_CANDIDATE = ['parsed', 'matched', 'disputed', 'approved'] as const satisfies readonly InvoiceStatus[];
