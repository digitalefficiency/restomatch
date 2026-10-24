import {
  and,
  eq,
  goodsReceipts,
  gte,
  invoices,
  matchRuns,
  purchaseOrders,
  sql,
  type Database,
} from '@restomatch/db';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';

/**
 * When a scanned invoice may be matched against its receipt.
 *
 * The receiving wizard registers the invoice photo BEFORE the receiver counts.
 * If the OCR job auto-matched straight away, the goods receipt still had no
 * counted lines: the engine saw "received 0" on every line (QTY_SHORT + a
 * blocking QTY_OVER of the full line total) and the leak hero jumped by the
 * whole invoice. So:
 *   - the OCR job does NOT auto-match while the invoice's receipt is still open
 *     (`pending`) — receiptStillOpenForInvoice();
 *   - submitting the receipt matches the invoices that were waiting on it —
 *     invoicesWaitingOnReceipt();
 *   - an invoice with no receipt (email / WhatsApp / upload) auto-matches as before.
 *
 * "The invoice's receipt" is exactly the one the matcher would use
 * (buildMatchInputForInvoice: the PO by supplier + date, then its latest GR).
 *
 * Race: submitReceipt runs in a transaction, and the OCR job can finish at any
 * moment. Both sides take lockReceipt(grId) first, so OCR either waits for the
 * submit to commit (and sees the receipt closed), or runs first — having already
 * committed the invoice as `matched` — and the submit, holding the lock next,
 * finds it waiting.
 */

/** Serialise "is this receipt closed?" against submitting it (held to the end of the tx). */
export async function lockReceipt(tx: Database, grId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gr-close:${grId}`}))`);
}

/** The goods receipt the matcher would pair this invoice with, if any. */
export async function receiptForInvoice(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<string | null> {
  const built = await buildMatchInputForInvoice(db, restaurantId, invoiceId);
  return built?.grId ?? null;
}

/**
 * True while the invoice's receipt exists and is still being counted. The OCR
 * job then leaves the match to submitReceipt. Call inside a transaction (the
 * receipt lock is transaction-scoped).
 */
export async function receiptStillOpenForInvoice(
  tx: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<boolean> {
  const grId = await receiptForInvoice(tx, restaurantId, invoiceId);
  if (!grId) return false;
  await lockReceipt(tx, grId);
  const [gr] = await tx
    .select({ status: goodsReceipts.status })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  return gr?.status === 'pending';
}

/** How far back submitReceipt looks for invoices of the PO's supplier. */
export const WAITING_INVOICE_LOOKBACK_DAYS = 14;

/**
 * Invoices that were waiting for this receipt to close: same supplier as the
 * receipt's PO, confidently read by OCR (status `matched` — the set the OCR job
 * would have auto-matched; held duplicates excluded the same way), not matched
 * yet, and paired with THIS receipt by the matcher. Invoices still in OCR are
 * not listed: their OCR job matches them once it sees the receipt closed.
 */
export async function invoicesWaitingOnReceipt(
  tx: Database,
  restaurantId: string,
  grId: string,
): Promise<string[]> {
  const [gr] = await tx
    .select({ supplierId: purchaseOrders.supplierId })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  if (!gr?.supplierId) return [];

  const since = new Date(Date.now() - WAITING_INVOICE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await tx
    .select({ id: invoices.id, ocrPayload: invoices.ocrPayload })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.supplierId, gr.supplierId),
        eq(invoices.status, 'matched'),
        gte(invoices.createdAt, since),
        sql`not exists (select 1 from ${matchRuns} where ${matchRuns.invoiceId} = ${invoices.id} and ${matchRuns.restaurantId} = ${restaurantId})`,
      ),
    );

  const out: string[] = [];
  for (const c of candidates) {
    const raw = c.ocrPayload?.raw as { duplicateOf?: unknown } | null | undefined;
    if (raw?.duplicateOf !== undefined) continue; // OCR never auto-matches a held duplicate
    if ((await receiptForInvoice(tx, restaurantId, c.id)) === grId) out.push(c.id);
  }
  return out;
}
