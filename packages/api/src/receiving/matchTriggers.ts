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
 * The receipt's state under its lock — call inside a transaction: whether it is
 * still being counted, and its PO (the order the receiver is counting). A
 * receipt of another restaurant reads as closed, with no PO.
 */
export async function receiptState(
  tx: Database,
  restaurantId: string,
  grId: string,
): Promise<{ open: boolean; poId: string | null }> {
  await lockReceipt(tx, grId);
  const [gr] = await tx
    .select({ status: goodsReceipts.status, poId: goodsReceipts.poId })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  return { open: gr?.status === 'pending', poId: gr?.poId ?? null };
}

/** True while the receipt is still being counted (see receiptState). */
export async function receiptStillOpen(tx: Database, restaurantId: string, grId: string): Promise<boolean> {
  return (await receiptState(tx, restaurantId, grId)).open;
}

/**
 * Does this invoice belong to THIS receipt, unambiguously? The matcher must pair
 * it with the receipt when the receipt's own PO is pinned (pinning matters:
 * discovery alone prefers a same-supplier sibling PO that already has a
 * receipt) — and it must NOT also pair with another still-open receipt of the
 * same supplier. Two orders of one supplier on the same day both win the
 * same-day tie when pinned, so a scan taken on the sibling's open receipt would
 * otherwise be claimed by whichever receipt is submitted first and matched
 * against the wrong count. An ambiguous scan is left for its own receipt (or a
 * manager's match.runForInvoice), never guessed.
 */
async function pairsWithReceipt(
  tx: Database,
  restaurantId: string,
  invoiceId: string,
  receipt: { id: string; poId: string | null },
): Promise<boolean> {
  const built = await buildMatchInputForInvoice(tx, restaurantId, invoiceId, { pinnedPoId: receipt.poId });
  if (built?.grId !== receipt.id) return false;

  const [inv] = await tx
    .select({ supplierId: invoices.supplierId })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv?.supplierId) return true;
  const openSiblings = await tx
    .select({ id: goodsReceipts.id, poId: goodsReceipts.poId })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .where(
      and(
        eq(goodsReceipts.restaurantId, restaurantId),
        eq(goodsReceipts.status, 'pending'),
        eq(purchaseOrders.supplierId, inv.supplierId),
        sql`${goodsReceipts.id} <> ${receipt.id}`,
      ),
    );
  for (const sibling of openSiblings) {
    const other = await buildMatchInputForInvoice(tx, restaurantId, invoiceId, { pinnedPoId: sibling.poId });
    if (other?.grId === sibling.id) return false; // ambiguous: it would also be that open receipt's scan
  }
  return true;
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
    .select({ supplierId: purchaseOrders.supplierId, poId: goodsReceipts.poId })
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
    if (await pairsWithReceipt(tx, restaurantId, c.id, { id: grId, poId: gr.poId })) out.push(c.id);
  }
  return out;
}

/** Statuses a receipt submit must never re-open: a person already signed the invoice off. */
const SETTLED_STATUSES = ['approved', 'paid'] as const;

/**
 * The client's "scanned on this receipt" ids, narrowed to what a receipt submit
 * may legitimately re-match: this restaurant's invoices, never approved/paid,
 * that either were already matched against THIS receipt or have no run yet AND
 * pair with this receipt (its PO pinned). Anything else would let a receiver
 * (who can't call match.runForInvoice) match an unrelated invoice — e.g. a scan
 * still held on another, open receipt, which would then be matched against an
 * empty count.
 */
export async function scannedInvoicesForReceipt(
  tx: Database,
  restaurantId: string,
  receipt: { id: string; poId: string | null },
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      id: invoices.id,
      runHere: sql<boolean>`exists (select 1 from ${matchRuns} where ${matchRuns.invoiceId} = ${invoices.id} and ${matchRuns.restaurantId} = ${restaurantId} and ${matchRuns.grId} = ${receipt.id})`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.id, ids),
        sql`${invoices.status} not in (${sql.join(
          SETTLED_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        sql`not exists (select 1 from ${matchRuns} where ${matchRuns.invoiceId} = ${invoices.id} and ${matchRuns.restaurantId} = ${restaurantId} and ${matchRuns.grId} is distinct from ${receipt.id})`,
      ),
    );
  const out: string[] = [];
  for (const r of rows) {
    if (r.runHere || (await pairsWithReceipt(tx, restaurantId, r.id, receipt))) out.push(r.id);
  }
  return out;
}
