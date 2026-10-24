import {
  and,
  eq,
  goodsReceipts,
  gte,
  inArray,
  invoices,
  matchRuns,
  purchaseOrders,
  sql,
  type Database,
} from '@restomatch/db';
import { buildMatchInputForInvoice } from '../match/buildMatchInput';

/**
 * Which invoices to (re-)match when a goods receipt closes, and when the OCR job
 * may match on its own.
 *
 * The receiving wizard registers the invoice photo BEFORE counting. Matching
 * against a receipt with nothing counted reads "received 0" on every line (a
 * false leak of the whole invoice), so the OCR job holds while the scan's
 * receipt is still `pending`, and submitReceipt matches once the count is in.
 *
 * Race: submitReceipt runs in a transaction while an OCR job can finish at any
 * moment. Both take lockReceipt(grId) first, so the OCR check either waits for
 * the submit to commit (and sees the receipt closed → matches itself), or ran
 * first — with the invoice already committed as `matched` — and the submit,
 * holding the lock next, finds it via invoicesWaitingOnReceipt().
 */

/** Serialise "is this receipt closed?" against closing it (held to the end of the tx). */
export async function lockReceipt(tx: Database, grId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gr-close:${grId}`}))`);
}

/**
 * True while the receipt is still being counted. Takes the receipt lock — call
 * inside a transaction. A receipt of another restaurant reads as not open.
 */
export async function receiptStillOpen(tx: Database, restaurantId: string, grId: string): Promise<boolean> {
  await lockReceipt(tx, grId);
  const [gr] = await tx
    .select({ status: goodsReceipts.status })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  return gr?.status === 'pending';
}

/** How far back submitReceipt looks for invoices of the receipt's supplier. */
export const WAITING_INVOICE_LOOKBACK_DAYS = 14;

/**
 * Invoices that were waiting for this receipt — derived server-side, so a
 * wizard that lost its in-memory invoice id (reload, phone lock, retake) still
 * gets its scan matched: same supplier as the receipt's PO, confidently read by
 * OCR (status `matched`, the set the OCR job auto-matches; held duplicates
 * excluded the same way), no run yet, and paired with THIS receipt by the
 * matcher. Invoices still in OCR are not listed: their OCR job matches them once
 * it sees the receipt closed.
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
    const built = await buildMatchInputForInvoice(tx, restaurantId, c.id);
    if (built?.grId === grId) out.push(c.id);
  }
  return out;
}

/** Statuses a receipt submit must never re-open: a person already signed the invoice off. */
const SETTLED_STATUSES = ['approved', 'paid'] as const;

/**
 * The client's "scanned on this receipt" ids, narrowed to what a receipt submit
 * may legitimately re-match: this restaurant's invoices that have no run yet or
 * whose run is on THIS receipt, and that nobody approved/paid. Anything else
 * would let a receiver (who can't call match.runForInvoice) rewrite an
 * unrelated invoice's match.
 */
export async function scannedInvoicesForReceipt(
  tx: Database,
  restaurantId: string,
  grId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.id, ids),
        sql`${invoices.status} not in (${sql.join(
          SETTLED_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        sql`not exists (select 1 from ${matchRuns} where ${matchRuns.invoiceId} = ${invoices.id} and ${matchRuns.restaurantId} = ${restaurantId} and ${matchRuns.grId} is distinct from ${grId})`,
      ),
    );
  return rows.map((r) => r.id);
}
