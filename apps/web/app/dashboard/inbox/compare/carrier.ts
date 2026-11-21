/** One invoice the "checked together" dialog shows (the page, a head it may continue, or the carrier a head is already included in). */
export interface CarrierOption {
  id: string;
  role: 'page' | 'head' | 'carrier';
  supplier: string | null;
  number: string | null;
  total: number | null;
}

/**
 * G-09 · which invoice the dialog offers as the payable carrier, and which it picks.
 * Round 12 (#10): only the invoices OFFERED for this answer — the page, the head the
 * person compares with, and the carrier it is already included in; never another head.
 * Round 11 (M5): the default is the offered invoice with the largest printed ₪ (the one
 * printing the document total); a pick that is no longer offered falls back to it.
 */
export function carrierChoice(options: CarrierOption[], withHead: string | null, picked: string | null) {
  const offered = options.filter((o) => o.role === 'page' || o.role === 'carrier' || o.id === withHead);
  const totalCarrier = offered.filter((o) => o.total !== null).sort((x, y) => (y.total ?? 0) - (x.total ?? 0))[0] ?? null;
  const payable = picked && offered.some((o) => o.id === picked) ? picked : (totalCarrier?.id ?? null);
  return { offered, totalCarrier, payable };
}
