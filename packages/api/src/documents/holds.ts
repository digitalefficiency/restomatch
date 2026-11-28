import { sql } from '@restomatch/db';
import type { SQL } from 'drizzle-orm';

/**
 * G-09 (rounds 13/14 #3, N4, N5, M3) · ONE rule for "this page still waits for a person",
 * used by the "checked together" answer AND by the carrier's re-match (its persist race
 * guard), so a page is never folded into a carrier's match before that person answered.
 *
 * The OCR's own per-document checks that any single PAGE of a longer document trips — no
 * number / date / total on this page, sums that only close on the last page, "continues
 * on another page" — are exactly the pages settle asks about: they are NOT a person's hold
 * here (round 14 N5). Everything else the OCR parked for review still is.
 */
export const PARTIAL_PAGE_REASONS = [
  'missing_invoice_number',
  'missing_invoice_date',
  'missing_total',
  'missing_subtotal',
  'missing_vat',
  'subtotal_mismatch',
  'vat_mismatch',
  'total_mismatch',
  'continues_on_another_page',
] as const;

const PARTIAL = sql.raw(`array[${PARTIAL_PAGE_REASONS.map((r) => `'${r}'`).join(', ')}]`);

/**
 * Boolean SQL: invoice `a` (an alias of invoices) is on hold for a person. `group` is a
 * uuid[] SQL expression of the document's invoices (carrier + pages): a duplicate stamp
 * naming one of them is the same document, never a hold.
 *
 *  - held for links, or typed by hand (raw.manualLines / raw.ocrFailed), while a non-charge
 *    line still has no product (round 14 N4: a failed read whose lines a person typed AND
 *    linked is no longer held — the matcher's own rule);
 *  - 'parsed' for a review reason beyond the partial-page ones, for a duplicate stamp
 *    naming an invoice OUTSIDE the document, or for no recorded reason at all (unless its
 *    only stamp names a page of the document).
 */
export function pageOnHoldSql(alias: string, group: SQL): SQL {
  const a = sql.raw(alias);
  const reasons = sql`(coalesce(case when jsonb_typeof(${a}.ocr_payload -> 'raw' -> 'reviewReasons') = 'array' then ${a}.ocr_payload -> 'raw' -> 'reviewReasons' end, '[]'::jsonb)
                      || coalesce(case when jsonb_typeof(${a}.ocr_payload -> 'raw' -> 'checks' -> 'reasons') = 'array' then ${a}.ocr_payload -> 'raw' -> 'checks' -> 'reasons' end, '[]'::jsonb))`;
  const stampOf = sql`(${a}.ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId')`;
  const stamped = sql`(${a}.ocr_payload -> 'raw' -> 'duplicateOf') is not null`;
  const stampInGroup = sql`(${stampOf} is not null and ${stampOf} ~* '^[0-9a-f-]{36}$' and ${stampOf}::uuid = any(${group}))`;
  return sql`(
    ((coalesce(${a}.ocr_payload ? 'linkReleasedAt', false)
       or coalesce(${a}.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ?| array['unlinked', 'unlinkedPo']
       or coalesce(${a}.ocr_payload -> 'raw' -> 'manualLines' = 'true'::jsonb, false)
       or coalesce(${a}.ocr_payload -> 'raw' -> 'ocrFailed' = 'true'::jsonb, false))
     and exists (select 1 from invoice_lines hl where hl.invoice_id = ${a}.id and hl.product_id is null
                  and not (coalesce(${a}.ocr_payload -> 'chargeLineIds', '[]'::jsonb) ? hl.id::text)))
    or (${a}.status = 'parsed' and (
          exists (select 1 from jsonb_array_elements_text(${reasons}) r(code) where r.code <> all(${PARTIAL}))
          or (${stamped} and not ${stampInGroup})
          or (jsonb_array_length(${reasons}) = 0 and not (${stamped} and ${stampInGroup}))
        ))
  )`;
}
