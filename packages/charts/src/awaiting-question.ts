import { sql } from '@restomatch/db';

/**
 * G-08 · "held for a זה אותו מוצר? question" — LIVE (round 3): true only while
 * the invoice (alias `i`) is held ('parsed') AND a question is really open:
 *   - 'unlinked'   while one of its lines is unlinked and not a charge line;
 *   - 'unlinkedPo' while the order it waits for (heldPoId) has an unlinked,
 *                  name-only, non-blank line.
 * An invoice held for another reason too (confidence, a duplicate) whose
 * questions are all answered is NOT in this bucket — it reads "לבדיקה".
 * The api's pruneAnsweredReasons clears heldPoId when a learned charge key
 * covers the order's last question.
 */
export const AWAITING_QUESTION_SQL = sql.raw(`(i.status = 'parsed' AND (
  (COALESCE(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinked'
    AND EXISTS (SELECT 1 FROM invoice_lines qil
                 WHERE qil.invoice_id = i.id AND qil.product_id IS NULL
                   AND NOT (COALESCE(i.ocr_payload -> 'chargeLineIds', '[]'::jsonb) ? qil.id::text)))
  OR (COALESCE(i.ocr_payload -> 'raw' -> 'reviewReasons', '[]'::jsonb) ? 'unlinkedPo'
    AND (i.ocr_payload ->> 'heldPoId') IS NOT NULL
    AND EXISTS (SELECT 1 FROM po_lines qpl
                  JOIN purchase_orders qpo ON qpo.id = qpl.po_id AND qpo.restaurant_id = i.restaurant_id
                 WHERE qpl.po_id = (i.ocr_payload ->> 'heldPoId')::uuid
                   AND qpl.product_id IS NULL AND qpl.supplier_sku IS NULL
                   AND COALESCE(btrim(qpl.raw_description), '') <> ''))
))`);
