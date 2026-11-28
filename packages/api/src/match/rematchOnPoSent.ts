import { sql, type Database } from '@restomatch/db';
import { requeueInvoicesForRematch, type RematchReport } from '../routers/mapping';
import type { AfterCommit } from '../trpc';

/**
 * G-04 follow-up Q4 (owner decision 11.11, Q4 (א)): once a draft order leaves
 * 'draft', re-match the invoices PINNED to it, automatically. Before this,
 * someone had to press "התאם מחדש": a draft pin is skipped
 * (`pinSkipped: 'po_draft'`), so those invoices sat on UNORDERED_ARRIVAL.
 *
 * The ways a PO leaves 'draft': orders.placeOrder, orders.sendMany,
 * orders.markSentManually ("שלחתי מהוואטסאפ שלי") and orders.importPo when a
 * re-import promotes an existing draft to 'sent'. Each calls
 * queueRematchOnPoSent.
 *
 * Which invoices (same restaurant AND same supplier as the PO, always), and
 * only these, as the owner signed it:
 * - the latest match run already points at this PO (a pre-G-04 draft pin), or
 * - the invoice is link-pinned to it (`ocr_payload.linkPinPoId`, or
 *   `heldPoId` while a link question still holds it).
 * An unpinned invoice with an open or escalated UNORDERED_ARRIVAL near the
 * delivery date is NOT re-matched here: pairing it with an unrelated order
 * would change findings the owner may be deciding.
 *
 * The enqueue runs after the sending transaction commits (queueRematchOnPoSent
 * → ctx.afterCommit), so a rolled-back send queues nothing and the job never
 * sees the PO still in draft. Each enqueue carries a dedupe key per (PO, send,
 * invoice), so a retried hook queues each invoice at most once per send.
 * requeueInvoicesForRematch keeps its rules: settled, claimed and consolidated
 * invoices are never re-matched.
 */
export async function invoicesAwaitingPo(db: Database, restaurantId: string, poId: string): Promise<string[]> {
  const res = await db.execute(sql`
    WITH po AS (
      SELECT id, supplier_id
      FROM purchase_orders
      WHERE id = ${poId} AND restaurant_id = ${restaurantId}
    ),
    latest AS (
      SELECT DISTINCT ON (mr.invoice_id) mr.invoice_id, mr.po_id
      FROM match_runs mr
      WHERE mr.restaurant_id = ${restaurantId} AND mr.invoice_id IS NOT NULL
      ORDER BY mr.invoice_id, mr.run_at DESC, mr.id DESC
    )
    SELECT i.id
    FROM invoices i
    CROSS JOIN po
    LEFT JOIN latest l ON l.invoice_id = i.id
    WHERE i.restaurant_id = ${restaurantId}
      AND i.supplier_id = po.supplier_id
      AND (
        l.po_id = po.id
        OR i.ocr_payload ->> 'linkPinPoId' = po.id::text
        OR i.ocr_payload ->> 'heldPoId' = po.id::text
      )
    ORDER BY i.id
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

/**
 * The dedupe key of the one re-match a send queues for an invoice. `sendStamp`
 * is the committed send (sent_at — every draft exit stamps it, an import's
 * promotion included — else updated_at), so a later, different send of the
 * same PO is never swallowed by an older key (finished jobs keep their key
 * until pruned).
 */
export const poSentRematchKey = (poId: string, sendStamp: string, invoiceId: string) =>
  `rematch:po-sent:${poId}:${sendStamp}:${invoiceId}`;

/** The committed send stamp of a PO that is no longer a draft, or null (still draft / not found). */
async function sendStampOf(db: Database, restaurantId: string, poId: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT status, (extract(epoch from COALESCE(sent_at, updated_at)) * 1000)::bigint::text AS stamp
    FROM purchase_orders
    WHERE id = ${poId} AND restaurant_id = ${restaurantId}
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    status: string;
    stamp: string | null;
  }>;
  const row = rows[0];
  if (!row || row.status === 'draft' || !row.stamp) return null;
  return row.stamp;
}

const EMPTY_REPORT: RematchReport = { requeued: 0, blockedByClaims: 0, consolidated: 0, settled: 0, failed: 0 };

/**
 * Queue the re-matches for a PO that left 'draft'. Call it with a db that sees
 * the send committed (queueRematchOnPoSent does). A PO still in draft queues
 * nothing. Best effort: a queue failure is counted, never thrown.
 */
export async function rematchOnPoSent(db: Database, restaurantId: string, poId: string): Promise<RematchReport> {
  const stamp = await sendStampOf(db, restaurantId, poId);
  if (!stamp) return { ...EMPTY_REPORT };
  const ids = await invoicesAwaitingPo(db, restaurantId, poId);
  return requeueInvoicesForRematch(db, restaurantId, ids, {
    dedupeKey: (invoiceId) => poSentRematchKey(poId, stamp, invoiceId),
  });
}

/** Schedule rematchOnPoSent for after the member transaction commits (never inside it). */
export function queueRematchOnPoSent(ctx: { afterCommit: AfterCommit }, restaurantId: string, poId: string): void {
  ctx.afterCommit((db) => rematchOnPoSent(db, restaurantId, poId));
}
