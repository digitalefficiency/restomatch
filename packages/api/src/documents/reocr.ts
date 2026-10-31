import { and, eq, inArray, invoices, matchRuns, type Database } from '@restomatch/db';
import { OPEN_STATUSES } from './intake';

/* ──────────────────────────────────────────────────────────────────────────
 * The re-OCR and retire edges: INTERIM until G-05's invoice machine lands.
 *
 * Callers run these ONLY for restaurants with the multi-page switch on
 * (`settings.ingest.multiPage`, see ingest/grouping.ts) and only after
 * `invoiceClosedReason` returned null (open: no decided פער, no claim, not
 * approved/paid). They are the only two call sites to swap:
 *   reopenForOcr  → G-05 transition `reocr`  (parsed|matched, no decision, no claim → ocr_pending)
 *   retireInvoice → G-05 transition `retire` (needs an invoice_status value: human-PR via H-03/G-03)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Re-open an OPEN invoice for OCR (→ `ocr_pending`). Its match runs are
 * undecided by the caller's openness check; they are reset here, because a
 * re-OCR replaces invoice_lines and a plain match job skips an invoice that
 * already has a run, which would leave stale gaps (a false leak).
 */
export async function reopenForOcr(tx: Database, restaurantId: string, invoiceId: string): Promise<boolean> {
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
  if (moved.length === 0) return false;
  await tx.delete(matchRuns).where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
  return true;
}

/**
 * Retire an absorbed page invoice. INTERIM: invoice_status has no retired
 * value, so the open, undecided, unclaimed row is removed (match runs keep a
 * NULL invoice; its lines go with it).
 */
export async function retireInvoice(tx: Database, restaurantId: string, invoiceId: string): Promise<boolean> {
  await tx.delete(matchRuns).where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
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
