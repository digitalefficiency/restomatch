/**
 * Is a line-by-line supplier answer complete? Every line of the order appears
 * exactly once with an explicit quantity (0 = out of stock), and no line from
 * anywhere else. Pure — the route feeds it the order's lines from the portal view.
 */
export function incompleteAnswer(
  orderLineIds: readonly string[],
  lines: ReadonlyArray<{ poLineId: string; qtyAvailable?: number | null }>,
): 'incomplete_lines' | 'invalid_lines' | null {
  const own = new Set(orderLineIds);
  const seen = new Set<string>();
  for (const l of lines) {
    if (!own.has(l.poLineId) || seen.has(l.poLineId)) return 'invalid_lines';
    seen.add(l.poLineId);
    if (l.qtyAvailable == null) return 'incomplete_lines';
  }
  return seen.size === own.size ? null : 'incomplete_lines';
}
