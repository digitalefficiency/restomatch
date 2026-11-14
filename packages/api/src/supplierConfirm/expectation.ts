import type { SupplierResponseLine } from '@restomatch/db';

/**
 * Where a line's expected quantity comes from:
 *  - `ordered`: no supplier answer on record → the ordered quantity;
 *  - `confirmed`: the supplier answered and left this line as ordered (no stored
 *    entry, or a price-only entry) → the ordered quantity, confirmed;
 *  - `supplier`: the supplier will deliver less (a shortage, 0 = out of stock) →
 *    the supplier's quantity;
 *  - `supplier_more`: the supplier said MORE than ordered → the dock still expects
 *    the ordered quantity (an over-delivery is not something we asked for), and
 *    `supplierQty` keeps the supplier's number visible.
 */
export type ExpectedQtySource = 'ordered' | 'confirmed' | 'supplier' | 'supplier_more';

export interface ExpectedQty {
  qty: number;
  source: ExpectedQtySource;
  /** Only for `supplier_more`: what the supplier said they would send. */
  supplierQty?: number;
}

/**
 * The ONE expected quantity for an order line (G-10, deep-fix class 1 #1): what
 * the supplier confirmed on `/s/<token>` beats what was ordered for a shortage.
 * A supplier who answered 10 → 6 makes the dock expect 6 (4 missing by the
 * supplier's own word), not a silent 10 or a false "חסר" at the door.
 *
 * Only the structured line answer counts. A shortage the supplier wrote ONLY in
 * the free-text note ("העגבניות יגיעו מחר") is NOT part of the expectation: the
 * note is shown to the restaurant as-is, never parsed into a quantity.
 *
 * Pure, no db access. Consumers: W2-05 (receiving: the expected column and the
 * "הספק הודיע" chip) and H-08 (wave 4). `answer` = the stored
 * `supplier_responses` row (its `lines` are differences only: an unchanged line
 * has no entry), or null when the supplier has not answered.
 */
export function expectedQtyForLine(
  poLine: { id: string; qtyOrdered: number | string },
  answer: { lines: ReadonlyArray<SupplierResponseLine> } | null,
): ExpectedQty {
  const ordered = Number(poLine.qtyOrdered);
  if (!answer) return { qty: ordered, source: 'ordered' };
  const entry = answer.lines.find((l) => l.poLineId === poLine.id);
  if (!entry || entry.qtyAvailable === null || entry.qtyAvailable === undefined) {
    return { qty: ordered, source: 'confirmed' };
  }
  const supplierQty = Number(entry.qtyAvailable);
  if (supplierQty > ordered) return { qty: ordered, source: 'supplier_more', supplierQty };
  return { qty: supplierQty, source: 'supplier' };
}
