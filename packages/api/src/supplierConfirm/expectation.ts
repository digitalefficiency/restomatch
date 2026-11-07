import type { SupplierResponseLine } from '@restomatch/db';

/**
 * The ONE expected quantity for an order line (G-10, deep-fix class 1 #1):
 * what the supplier confirmed on `/s/<token>` beats what was ordered. A
 * supplier who answered 10 → 6 makes the dock expect 6 (4 missing by the
 * supplier's own word), not a silent 10 or a false "חסר" at the door.
 *
 *  - the supplier's `qtyAvailable` (0 stays 0 — out of stock) → `source: 'supplier'`;
 *  - no answer, no entry for the line, or a price-only entry → the ordered qty.
 *
 * Pure, no db access. Consumers: W2-05 (receiving: the expected column and the
 * "הספק הודיע" chip) and H-08 (wave 4). `answer` = `supplier_responses.lines`
 * (differences only: an unchanged line has no entry).
 */
export function expectedQtyForLine(
  poLine: { id: string; qtyOrdered: number | string },
  answer: { lines: ReadonlyArray<SupplierResponseLine> } | null,
): { qty: number; source: 'supplier' | 'ordered' } {
  const entry = answer?.lines.find((l) => l.poLineId === poLine.id);
  if (entry && entry.qtyAvailable !== null && entry.qtyAvailable !== undefined) {
    return { qty: Number(entry.qtyAvailable), source: 'supplier' };
  }
  return { qty: Number(poLine.qtyOrdered), source: 'ordered' };
}
