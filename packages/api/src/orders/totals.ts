import { eq, poLines, purchaseOrders, type Database } from '@restomatch/db';

/**
 * Estimated PO total, exact to the agora: each priced line is `qty × unit
 * price` rounded half-up to whole agorot, then the integer agorot are summed —
 * never a float running sum (AGENTS.md money facts). Unpriced lines are skipped;
 * a PO with no priced line has no estimate (null). Returns NUMERIC-style text.
 */
export function estimateTotal(
  lines: Array<{ qty: number | string; unitPriceExpected?: number | string | null }>,
): string | null {
  let agorot = 0;
  let any = false;
  for (const l of lines) {
    if (l.unitPriceExpected == null || l.unitPriceExpected === '') continue;
    const qty = Number(l.qty);
    const price = Number(l.unitPriceExpected);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    // +1e-9 guards the half-up step against binary artefacts (1.005 × 100 = 100.49999…).
    agorot += Math.round(qty * price * 100 + 1e-9);
    any = true;
  }
  return any ? (agorot / 100).toFixed(2) : null;
}

/**
 * Re-derive `purchase_orders.total_estimated` from the PO's current lines. Call
 * after any line edit/delete so the order header never shows a stale total.
 */
export async function recomputePoTotal(db: Database, poId: string): Promise<string | null> {
  const lines = await db
    .select({ qty: poLines.qtyOrdered, unitPriceExpected: poLines.unitPriceExpected })
    .from(poLines)
    .where(eq(poLines.poId, poId));
  const total = estimateTotal(lines);
  await db
    .update(purchaseOrders)
    .set({ totalEstimated: total, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, poId));
  return total;
}
