import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';

/**
 * ₪ for ledger-style figures: whole shekels without ".00", agorot shown only
 * when the amount has them (₪3,420 · ₪1,284.50). Thin wrapper over formatIls().
 */
export function ilsExact(value: number, locale: Locale): string {
  return formatIls(value, { locale, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 });
}

/** Israeli VAT for the showcase invoices (18% since 2025-01-01). */
export const SHOWCASE_VAT_RATE = 0.18;
/** "18" — for "VAT 18%" labels. */
export const SHOWCASE_VAT_PCT = Math.round(SHOWCASE_VAT_RATE * 100);
