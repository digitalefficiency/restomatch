import { sql } from '@restomatch/db';

type SQL = ReturnType<typeof sql>;
import { PAGE_FLAGS } from './settle';

/** Page flags whose page probably BELONGS to the invoice before it (page 1 waits too). */
const PAGE_ONE_FLAGS = ['page_not_merged', 'page_merge_blocked', 'page_too_large'] as const;

/**
 * G-09 (round 7) · "this invoice has an open page question" as a SQL boolean,
 * for `invoiceId` (an SQL expression of the invoice's id) in restaurant `rid`:
 *  - one of its own page rows is flagged (any PAGE_FLAGS), or
 *  - it is PAGE 1 of a flagged page: the invoice right before a page_not_merged /
 *    page_merge_blocked / page_too_large page from the same channel + sender.
 * Shared by the approvals queue, the pay run and ingest.pageQuestionOf.
 */
/**
 * Round 7: a flagged page row `alias` that still asks something. An unreadable
 * page whose invoice since got lines (typed by hand, or a later read) or a run
 * is answered — never a dead end.
 */
export function openFlagSql(alias: string): SQL {
  const all = sql.join(PAGE_FLAGS.map((f) => sql`${f}`), sql`, `);
  const a = sql.raw(alias);
  return sql`(${a}.status = 'registered' AND ${a}.error IN (${all})
    AND NOT (${a}.error = 'page_unreadable' AND (
      EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = ${a}.invoice_id)
      OR EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = ${a}.invoice_id AND mr.restaurant_id = ${a}.restaurant_id))))`;
}

export function openPageQuestionSql(rid: string, invoiceId: SQL): SQL {
  const one = sql.join(PAGE_ONE_FLAGS.map((f) => sql`${f}`), sql`, `);
  return sql`(
    EXISTS (SELECT 1 FROM ingest_documents q
             WHERE q.restaurant_id = ${rid} AND q.invoice_id = ${invoiceId}
               AND ${openFlagSql('q')})
    OR EXISTS (
      SELECT 1 FROM ingest_documents q
        JOIN ingest_messages qm ON qm.id = q.message_id AND qm.restaurant_id = q.restaurant_id
       WHERE q.restaurant_id = ${rid} AND q.status = 'registered' AND q.error IN (${one})
         AND q.invoice_id IS NOT NULL AND q.invoice_id <> ${invoiceId}
         AND ${invoiceId} = (
           SELECT p.invoice_id FROM ingest_documents p
             JOIN ingest_messages pm ON pm.id = p.message_id AND pm.restaurant_id = p.restaurant_id
            WHERE p.restaurant_id = q.restaurant_id AND p.status = 'registered'
              AND p.invoice_id IS NOT NULL AND p.invoice_id <> q.invoice_id
              AND pm.channel_id = qm.channel_id AND pm.sender = qm.sender
              AND pm.received_at <= qm.received_at AND pm.received_at >= qm.received_at - interval '24 hours'
            ORDER BY pm.received_at DESC, p.created_at DESC LIMIT 1)
    ))`;
}
