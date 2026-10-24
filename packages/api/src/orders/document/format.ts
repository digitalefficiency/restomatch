/**
 * ₪ for supplier-facing documents. Same Intl settings as the web's
 * `formatIls(v, { maximumFractionDigits: 2 })` (apps/web/lib/money.ts — not
 * importable from the API), minus the bidi control marks Intl inserts: the PDF
 * font has no glyph for them and plain-text clients render them inconsistently.
 */
const fmt = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ilsFromAgorot(agorot: number): string {
  return fmt
    .format(agorot / 100)
    .replace(/[‎‏؜]/g, '')
    .replace(/ /g, ' ')
    .trim();
}

/** "2.500" → "2.5", "3.000" → "3": what a supplier reads. */
export function qtyText(qty: string): string {
  return qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
}
