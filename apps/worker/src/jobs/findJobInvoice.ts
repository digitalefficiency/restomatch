import { and, eq, invoices, type Database } from '@restomatch/db';

/**
 * Backoff (ms) between re-reads of a job's invoice row: ~7.75 s in total.
 *
 * receiving.registerInvoice enqueues the OCR job from INSIDE memberProcedure's
 * RLS transaction, so a fast worker can read before the invoice row commits.
 * The job then failed the tenant guard ("not found … refusing to process"),
 * BullMQ does not retry it (1 attempt), and the scan stayed "still reading"
 * forever — about 1 upload in 10 locally.
 */
export const INVOICE_COMMIT_GRACE_MS: readonly number[] = [250, 500, 1000, 2000, 4000];

/**
 * The job's invoice, read with the tenant guard (id AND restaurant from the
 * payload), re-checked with a short backoff before it is treated as missing.
 * A payload naming another restaurant's invoice still finds nothing and is
 * refused, only after the grace period instead of at once.
 */
export async function findJobInvoice(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  delaysMs: readonly number[] = INVOICE_COMMIT_GRACE_MS,
): Promise<{ id: string; supplierId: string | null } | null> {
  for (let attempt = 0; ; attempt++) {
    const [row] = await db
      .select({ id: invoices.id, supplierId: invoices.supplierId })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1);
    if (row) return row;
    if (attempt >= delaysMs.length) return null;
    await new Promise((r) => setTimeout(r, delaysMs[attempt]));
  }
}
