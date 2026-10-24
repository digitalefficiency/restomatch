import {
  and,
  eq,
  goodsReceipts,
  gte,
  inArray,
  lte,
  invoices,
  matchRuns,
  purchaseOrders,
  sql,
  type Database,
} from '@restomatch/db';
import { buildMatchInputForInvoice, PO_MATCH_WINDOW_DAYS } from '../match/buildMatchInput';

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
 * The receipt a scan was taken on, as the OCR job stamped it into
 * `ocr_payload.raw.scanGrId` (from the job's grId, tenant-checked). Null for an
 * unstamped scan: email / upload, or a row from before the stamp.
 */
export function readScanGrId(ocrPayload: unknown): string | null {
  const raw = (ocrPayload as { raw?: unknown } | null | undefined)?.raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const id = (raw as { scanGrId?: unknown }).scanGrId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** The OCR result with the scan's receipt stamped in (unchanged without one). */
export function withScanGrId<T extends object>(raw: T, scanGrId: string | undefined): T | (T & { scanGrId: string }) {
  return scanGrId ? { ...raw, scanGrId } : raw;
}

/**
 * The grId to stamp on a scan: the job's grId only when that receipt is this
 * restaurant's AND its order is from the invoice's supplier. A forged / foreign
 * id, or a receipt of another supplier, stamps nothing (a stamp pointing at the
 * wrong supplier's receipt would orphan the scan: no receipt would ever claim
 * it), and the scan falls back to the pairing rule below.
 */
export async function scanReceiptToStamp(
  db: Database,
  restaurantId: string,
  grId: string | undefined,
  supplierId: string | null,
): Promise<string | undefined> {
  if (!grId || !supplierId) return undefined;
  const [gr] = await db
    .select({ id: goodsReceipts.id })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .where(
      and(
        eq(goodsReceipts.id, grId),
        eq(goodsReceipts.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, supplierId),
      ),
    )
    .limit(1);
  return gr?.id;
}

/** Two POs that can both pair with one invoice fall within twice the matcher's ± window. */
const SIBLING_WINDOW_MS = 2 * PO_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Does this invoice belong to THIS receipt? The matcher must pair it with the
 * receipt when the receipt's own PO is pinned (pinning matters: discovery alone
 * prefers a same-supplier sibling PO that already has a receipt), and then:
 *  - a stamped scan (readScanGrId) belongs to exactly the receipt it was taken
 *    on — no guess;
 *  - an unstamped one (email / upload, or OCR'd by a worker from before the
 *    stamp) must NOT also pair with any other receipt of the same supplier in
 *    the window — open OR closed. Two orders of one supplier on the same day
 *    both win the same-day tie when pinned, so the scan would otherwise be
 *    claimed by whichever receipt is submitted first (or, once the other is
 *    closed, by the later one) and matched against the wrong count. An
 *    ambiguous scan is left for a manager's match.runForInvoice, never guessed.
 */
async function pairsWithReceipt(
  tx: Database,
  restaurantId: string,
  invoiceId: string,
  receipt: { id: string; poId: string | null },
): Promise<boolean> {
  const [inv] = await tx
    .select({ supplierId: invoices.supplierId, ocrPayload: invoices.ocrPayload })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv) return false;
  const stamped = readScanGrId(inv.ocrPayload);
  if (stamped !== null && stamped !== receipt.id) return false; // another receipt's scan

  const built = await buildMatchInputForInvoice(tx, restaurantId, invoiceId, { pinnedPoId: receipt.poId });
  if (built?.grId !== receipt.id) return false;
  if (stamped !== null || !inv.supplierId) return true;

  const [own] = receipt.poId
    ? await tx
        .select({ at: purchaseOrders.expectedDeliveryAt })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, receipt.poId))
        .limit(1)
    : [];
  const near = own?.at
    ? and(
        gte(purchaseOrders.expectedDeliveryAt, new Date(own.at.getTime() - SIBLING_WINDOW_MS)),
        lte(purchaseOrders.expectedDeliveryAt, new Date(own.at.getTime() + SIBLING_WINDOW_MS)),
      )
    : undefined;
  const siblings = await tx
    .select({ id: goodsReceipts.id, poId: goodsReceipts.poId })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .where(
      and(
        eq(goodsReceipts.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, inv.supplierId),
        sql`${goodsReceipts.id} <> ${receipt.id}`,
        near,
      ),
    );
  for (const sibling of siblings) {
    const other = await buildMatchInputForInvoice(tx, restaurantId, invoiceId, { pinnedPoId: sibling.poId });
    if (other?.grId === sibling.id) return false; // ambiguous: it would also be that receipt's scan
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
