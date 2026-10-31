import { and, eq, inArray, invoices, type Database } from '@restomatch/db';
import { OPEN_STATUSES } from './intake';

/* ──────────────────────────────────────────────────────────────────────────
 * The re-OCR edge — INTERIM, DISABLED by default (brief §8 trap).
 *
 * A recomposed invoice must go back to `ocr_pending` so the worker re-reads
 * every page; G-05's machine has no such edge yet and the worker writes the
 * status only from `ocr_pending`. Until the orchestrator agrees a `reocr`
 * edge with G-05/G-06, cross-message grouping and attach/split are OFF in
 * production. These two functions are the only call sites to swap:
 *   reopenForOcr  → G-05 transition `reocr`  (parsed|matched, no decision, no claim → ocr_pending)
 *   retireInvoice → G-05 transition `retire` (needs an invoice_status value: human-PR via H-03/G-03)
 * ────────────────────────────────────────────────────────────────────────── */

export const REOCR_EDGE_ENABLED = false;
let reocrEdge = REOCR_EDGE_ENABLED;

export function reocrEdgeEnabled(): boolean {
  return reocrEdge;
}

/** Test seam only. */
export function __setReocrEdgeForTests(on: boolean): void {
  reocrEdge = on;
}

/** Re-open an OPEN invoice for OCR (→ `ocr_pending`). False when the edge is off or the invoice is not open. */
export async function reopenForOcr(tx: Database, restaurantId: string, invoiceId: string): Promise<boolean> {
  if (!reocrEdge) return false;
  const moved = await tx
    .update(invoices)
    .set({ status: 'ocr_pending', updatedAt: new Date() })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: invoices.id });
  return moved.length > 0;
}

/**
 * Retire an absorbed (already-split) invoice. INTERIM: invoice_status has no
 * retired value, so the open, undecided, unclaimed row is removed (match runs
 * keep a NULL invoice). G-05's retire transition replaces this body.
 */
export async function retireInvoice(tx: Database, restaurantId: string, invoiceId: string): Promise<boolean> {
  if (!reocrEdge) return false;
  const gone = await tx
    .delete(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: invoices.id });
  return gone.length > 0;
}
