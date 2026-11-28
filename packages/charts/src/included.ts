import { sql } from '@restomatch/db';

/**
 * G-09 (round 12 #5): a page a person "checked together" into another invoice of the same
 * document (raw.paidWith → a carrier that still exists). Its lines are matched with the
 * carrier's, so it never gets a run of its own — it is never "waiting to be linked", and
 * its page total is never a pending ₪ (the carrier's printed total holds it). Alias given.
 */
export function includedInLiveCarrierSql(alias: string) {
  const a = sql.raw(alias);
  return sql`(coalesce((${a}.ocr_payload -> 'raw') ? 'paidWith', false) AND EXISTS (
    SELECT 1 FROM invoices c
     WHERE c.restaurant_id = ${a}.restaurant_id
       AND c.id::text = ${a}.ocr_payload -> 'raw' -> 'paidWith' ->> 'invoiceId'))`;
}

/**
 * The same rule for a row of a `per` CTE (its `id` is the invoice): for the summaries built
 * on the view CTEs. leak-views.ts is immutable: its pending filters take this only through
 * an owner-signed human PR (proposed separately, never in #190).
 */
export const includedPerSql = sql`EXISTS (SELECT 1 FROM invoices x WHERE x.id = per.id AND ${includedInLiveCarrierSql('x')})`;
