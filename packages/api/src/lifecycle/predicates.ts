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
