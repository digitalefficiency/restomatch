/**
 * Enter / Next on a count (W2-07, mobile-field-10): the next UNCOUNTED line in
 * the same area, in the server's area order; at the end of an area, the first
 * uncounted line of the next area (wrapping to the start). 0 navigation taps
 * per line, and focus never lands on a select.
 */
export interface NavLine {
  productId: string;
  area: string;
  counted: boolean;
}

export function nextUncounted(lines: readonly NavLine[], currentId: string | null, areaOrder: readonly string[]): string | null {
  const rank = new Map(areaOrder.map((a, i) => [a, i] as const));
  // Stable: area order first, then the server's order inside an area.
  const ordered = lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (rank.get(a.l.area) ?? 99) - (rank.get(b.l.area) ?? 99) || a.i - b.i)
    .map((x) => x.l);
  const at = currentId == null ? -1 : ordered.findIndex((l) => l.productId === currentId);
  for (let k = 1; k <= ordered.length; k++) {
    const l = ordered[(at + k + ordered.length) % ordered.length]!;
    if (l.productId !== currentId && !l.counted) return l.productId;
  }
  return null;
}

/** The area a line belongs to after `currentId`'s area runs out — for the "next area" announcement. */
export function areaOf(lines: readonly NavLine[], productId: string | null): string | null {
  return lines.find((l) => l.productId === productId)?.area ?? null;
}
