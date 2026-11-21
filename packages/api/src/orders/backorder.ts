/**
 * W3-09 / AU-11 b · Backorder draft: which missing units to re-order (pure).
 *
 * THE GUARD (signed by leak-economist, AU-11 §5.5): never re-order units the
 * supplier BILLED but did not deliver. Those become a credit request; ordering
 * them again would make the restaurant pay twice for the same goods.
 *
 * Engine semantics (packages/matching/src/engine.ts, read-only):
 *  - billed > received raises QTY_OVER (deltaAmount = price × billed-not-received);
 *  - QTY_SHORT keeps only the shortfall the supplier did NOT bill, and drops to
 *    ₪0 when the invoice billed every missing unit.
 * So the guard reads billed-not-received units (QTY_OVER, or invoice qty billed
 * when not matched yet), never QTY_SHORT.
 *
 *   re-order qty = ordered − max(received, billed)
 *
 * A backorder never adds or removes leak ₪: it only decides what goes on a draft.
 */

export interface BackorderLineInput {
  poLineId: string;
  productId: string | null;
  description: string;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  /**
   * Units the supplier billed for this line: from an open/accepted QTY_OVER
   * (received + its billed-not-received units) or, when an invoice is linked but
   * not matched yet, the invoice line's qty billed. null = no invoice linked.
   */
  qtyBilled: number | null;
}

export interface BackorderLine {
  poLineId: string;
  productId: string | null;
  rawDescription: string;
  unit: string;
  qty: number;
}

export interface BackorderNote {
  poLineId: string;
  description: string;
  kind: 'billed_in_full' | 'billed_in_part';
}

export interface BackorderPlan {
  lines: BackorderLine[];
  notes: BackorderNote[];
  /** No invoice linked to any short line yet — the human must check before sending. */
  invoiceNotMatched: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function planBackorder(input: readonly BackorderLineInput[]): BackorderPlan {
  const lines: BackorderLine[] = [];
  const notes: BackorderNote[] = [];
  let anyShortWithoutInvoice = false;
  for (const l of input) {
    const ordered = r3(l.qtyOrdered);
    const received = r3(Math.max(0, l.qtyReceived));
    if (!(received < ordered)) continue; // not short
    if (l.qtyBilled === null) anyShortWithoutInvoice = true;
    const billed = l.qtyBilled === null ? 0 : r3(Math.max(0, l.qtyBilled));
    const covered = Math.max(received, billed);
    const qty = r3(ordered - covered);
    if (qty <= 0) {
      notes.push({ poLineId: l.poLineId, description: l.description, kind: 'billed_in_full' });
      continue;
    }
    if (billed > received) notes.push({ poLineId: l.poLineId, description: l.description, kind: 'billed_in_part' });
    lines.push({ poLineId: l.poLineId, productId: l.productId, rawDescription: l.description, unit: l.unit, qty });
  }
  return { lines, notes, invoiceNotMatched: anyShortWithoutInvoice && lines.length > 0 };
}
