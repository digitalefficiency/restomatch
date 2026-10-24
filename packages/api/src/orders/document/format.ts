import { formatIlsAgorot } from '../../reports/money';

/**
 * ₪ for supplier-facing documents (order email, WhatsApp text, PDF): the
 * server twin formatIlsAgorot (reports/money.ts — pinned to the web's
 * formatIls() by apps/web/lib/__tests__/money-parity.test.ts) at 2 decimals
 * (ILS already prints at least 2), minus the bidi control marks Intl inserts:
 * the PDF font has no glyph for them and plain-text clients render them
 * inconsistently. No inline Intl.NumberFormat here (AGENTS.md: one ₪ formatter).
 */
export function ilsFromAgorot(agorot: number): string {
  return formatIlsAgorot(agorot, { maximumFractionDigits: 2 })
    .replace(/[\u200e\u200f\u061c]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/** "2.500" → "2.5", "3.000" → "3": what a supplier reads. */
export function qtyText(qty: string): string {
  return qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty;
}
