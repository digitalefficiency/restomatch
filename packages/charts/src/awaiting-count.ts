import { sql } from '@restomatch/db';

type SQL = ReturnType<typeof sql>;

/**
 * A receiving scan waiting for its count (#94).
 *
 * The receiving wizard opens the goods receipt, the receiver photographs the
 * invoice (receiving.registerInvoice), counts, and submits. Until the submit the
 * scan has no match run on purpose: matching against an empty count would read
 * every line as short. invoices has no receipt column — the scan's own receipt
 * travels only in its OCR job (payload.grId) — so "this scan belongs to a receipt
 * still being counted" is derived the same way everywhere:
 *
 *   a photo scan (source 'photo') whose supplier has a goods receipt still
 *   `pending` that was opened in the SCAN_RECEIPT_LOOKBACK_HOURS before the scan
 *   was registered (the wizard opens the receipt first, then photographs).
 *
 * The OCR job (apps/worker ocrInvoice.ts) uses it for a receipt-less photo scan
 * (an OCR sweep retry of a lost enqueue): no auto-match while such a receipt is
 * open — that receipt's submit matches it (invoicesWaitingOnReceipt).
 *
 * Whenever the OCR job HOLDS a scan's match for a receipt's count (the job's own
 * grId, or the receipts above), it records those receipts on the invoice:
 * ocr_payload.raw.heldForReceipts (next to raw.duplicateOf). The leak hero, the
 * view summary, the breakdown and the pay run call an invoice "waiting for the
 * count" (scanAwaitingCountSql) while it has no match run and one of those
 * receipts is still pending — not "waiting to be linked to an order — probably a
 * consolidated invoice". Neither leak nor spend either way (no run).
 */
export const HELD_FOR_RECEIPTS_KEY = 'heldForReceipts';
export const SCAN_RECEIPT_LOOKBACK_HOURS = 24;

/**
 * The goods receipts (column `id`) the photo scan `invoiceId` may belong to that
 * are still being counted, as a subquery: `EXISTS (…)` for a flag, or append an
 * ORDER BY to list them. `invoiceId` is a correlated column (sql`inv.id`) or a uuid.
 */
export function receiptsBeingCountedForScan(restaurantId: string, invoiceId: SQL | string): SQL {
  const inv = typeof invoiceId === 'string' ? sql`${invoiceId}::uuid` : invoiceId;
  return sql`
    SELECT g.id
      FROM invoices si
      JOIN purchase_orders sp ON sp.restaurant_id = si.restaurant_id AND sp.supplier_id = si.supplier_id
      JOIN goods_receipts g ON g.po_id = sp.id AND g.restaurant_id = si.restaurant_id
     WHERE si.id = ${inv}
       AND si.restaurant_id = ${restaurantId}
       AND si.source = 'photo'
       AND g.status = 'pending'
       AND g.created_at <= si.created_at
       AND g.created_at > si.created_at - make_interval(hours => ${SCAN_RECEIPT_LOOKBACK_HOURS}::int)`;
}

/**
 * True while the OCR job's hold on this invoice still stands: one of the receipts
 * it recorded (ocr_payload.raw.heldForReceipts) is still being counted. `inv` is
 * the invoices row alias (sql`i`). Callers add "and no match run".
 */
export function scanAwaitingCountSql(restaurantId: string, inv: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM goods_receipts hg
     WHERE hg.restaurant_id = ${restaurantId}
       AND hg.status = 'pending'
       AND (${inv}.ocr_payload -> 'raw' -> ${sql.raw(`'${HELD_FOR_RECEIPTS_KEY}'`)}) @> jsonb_build_array(hg.id::text)
  )`;
}
