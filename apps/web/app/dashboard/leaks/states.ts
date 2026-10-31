/**
 * The three honest states of a leak figure (rubric A4), pure: no checked
 * invoice yet → `noData` (never a green or red ₪0), nothing leaked → `clean`,
 * else `leak`. A failure is the route's error.tsx ("לא זמין · נסו שוב").
 */
export type LeakState = 'noData' | 'clean' | 'leak';

export function leakStateOf(hero: { matchedInvoiceCount: number; leakIls: number }): LeakState {
  if (hero.matchedInvoiceCount <= 0 && hero.leakIls <= 0) return 'noData';
  return hero.leakIls > 0 ? 'leak' : 'clean';
}

/**
 * Why a discrepancy line carries ₪0 — said only when the engine's shape proves it:
 *  • `billedShort` — a QTY_SHORT zeroed because the invoice DID bill the missing
 *    units: they are counted once, in the same PO line's QTY_OVER block
 *    ("billed more than received") — the engine never counts them twice;
 *  • `none` — anything else (e.g. no unit price): no money impact on this line.
 */
export type ZeroNote = 'billedShort' | 'none';

export function zeroNoteOf(
  line: { type: string; poLineId: string | null; productId: string | null; discrepancyId: string },
  invoiceLines: ReadonlyArray<{ type: string; severity: string; poLineId: string | null; productId: string | null; deltaAmount: number; discrepancyId: string }>,
): ZeroNote {
  if (line.type !== 'QTY_SHORT') return 'none';
  const billed = invoiceLines.some(
    (o) =>
      o.discrepancyId !== line.discrepancyId &&
      o.type === 'QTY_OVER' &&
      o.severity === 'block' &&
      Math.abs(o.deltaAmount) >= 0.005 &&
      ((line.poLineId != null && o.poLineId === line.poLineId) || (line.poLineId == null && line.productId != null && o.productId === line.productId)),
  );
  return billed ? 'billedShort' : 'none';
}
