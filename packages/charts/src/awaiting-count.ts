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
 * Used by
 *   - the OCR job (apps/worker ocrInvoice.ts): a receipt-less photo scan (an OCR
 *     sweep retry of a lost enqueue) does not auto-match while such a receipt is
 *     open — that receipt's submit matches it (invoicesWaitingOnReceipt);
 *   - the leak hero / view summary / pay run: an unmatched scan in this state is
 *     "waiting for the count", not "waiting to be linked to an order — probably a
 *     consolidated invoice". Neither leak nor spend either way.
 */
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
