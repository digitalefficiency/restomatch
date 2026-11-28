import { sql, type Database } from '@restomatch/db';
import { PO_MATCH_WINDOW_DAYS } from './buildMatchInput';
import { discrepancyDecidableSql } from '../lifecycle/predicates';
import { requeueInvoicesForRematch, type RematchReport } from '../routers/mapping';

/**
 * G-04 follow-up Q4 (owner decision 11.11, Q4 (א)): once a draft order is sent
 * (orders.placeOrder / sendMany — the only ways a PO leaves 'draft'), re-match
 * the invoices that a draft could not serve, automatically. Before this, someone
 * had to press "התאם מחדש": a draft pin is skipped (`pinSkipped: 'po_draft'`) and
 * a draft is never discovered, so those invoices sat on UNORDERED_ARRIVAL.
 *
 * Which invoices (same restaurant AND same supplier as the PO, always):
 * - the latest match run already points at this PO (a pre-G-04 draft pin), or
 * - the invoice is link-pinned to it (`ocr_payload.linkPinPoId`), or
 * - the latest run holds an open/escalated UNORDERED_ARRIVAL and the invoice date
 *   is within the PO window (± PO_MATCH_WINDOW_DAYS, +1 day of slack for the
 *   restaurant's time zone) of the PO's expected delivery (created_at when unset).
 *
 * A re-match is idempotent (the engine replaces the run), and each enqueue
 * carries a dedupe key per (PO, invoice), so a retried or double-fired send
 * queues each invoice at most once. requeueInvoicesForRematch keeps its rules:
 * settled, claimed and consolidated invoices are never re-matched.
 */
export async function invoicesAwaitingPo(db: Database, restaurantId: string, poId: string): Promise<string[]> {
  const windowDays = PO_MATCH_WINDOW_DAYS + 1;
  const res = await db.execute(sql`
    WITH po AS (
      SELECT id, supplier_id, COALESCE(expected_delivery_at, created_at) AS at
      FROM purchase_orders
      WHERE id = ${poId} AND restaurant_id = ${restaurantId}
    ),
    latest AS (
      SELECT DISTINCT ON (mr.invoice_id) mr.id, mr.invoice_id, mr.po_id
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
        OR (
          EXISTS (
            SELECT 1 FROM discrepancies d
            WHERE d.match_run_id = l.id AND d.restaurant_id = ${restaurantId}
              AND d.type = 'UNORDERED_ARRIVAL' AND ${discrepancyDecidableSql(sql`d.resolution_status`)}
          )
          AND COALESCE(i.invoice_date, i.created_at)
            BETWEEN po.at - make_interval(days => ${windowDays}) AND po.at + make_interval(days => ${windowDays})
        )
      )
    ORDER BY i.id
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

/** The dedupe key of the one re-match a sent PO queues for an invoice. */
export const poSentRematchKey = (poId: string, invoiceId: string) => `rematch:po-sent:${poId}:${invoiceId}`;

/** Queue the re-matches for a PO that just left 'draft'. Best effort: a queue failure never fails the send. */
export async function rematchOnPoSent(db: Database, restaurantId: string, poId: string): Promise<RematchReport> {
  const ids = await invoicesAwaitingPo(db, restaurantId, poId);
  return requeueInvoicesForRematch(db, restaurantId, ids, { dedupeKey: (invoiceId) => poSentRematchKey(poId, invoiceId) });
}
