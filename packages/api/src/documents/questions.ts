import { sql } from '@restomatch/db';
import { PAGE_FLAGS, PAGE_ONE_FLAGS } from './settle';

type SQL = ReturnType<typeof sql>;

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

/**
 * G-09 · "this invoice has an open page question" as a SQL boolean, for
 * `invoiceId` (an SQL expression of the invoice's id) in restaurant `rid`:
 *  - one of its own page rows still asks something (openFlagSql), or
 *  - it is PAGE 1 of such a page: round 8 — the chain page settle RECORDED on a
 *    page_not_merged / page_merge_blocked / page_too_large page (raw.pageOf),
 *    never a "newest earlier row" guess (wrong for one-message or interleaved pages).
 * Shared by the approvals queue, the pay run and ingest.pageQuestionOf.
 */
export function openPageQuestionSql(rid: string, invoiceId: SQL): SQL {
  const one = sql.join(PAGE_ONE_FLAGS.map((f) => sql`${f}`), sql`, `);
  return sql`(
    EXISTS (SELECT 1 FROM ingest_documents q
             WHERE q.restaurant_id = ${rid} AND q.invoice_id = ${invoiceId}
               AND ${openFlagSql('q')})
    OR EXISTS (
      SELECT 1 FROM ingest_documents q
        JOIN invoices qi ON qi.id = q.invoice_id AND qi.restaurant_id = q.restaurant_id
       WHERE q.restaurant_id = ${rid} AND ${openFlagSql('q')} AND q.error IN (${one})
         AND qi.ocr_payload -> 'raw' -> 'pageOf' ->> 'invoiceId' = (${invoiceId})::text))`;
}
