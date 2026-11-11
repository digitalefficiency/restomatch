import { formatIlsAgorot } from '../reports/money';

/**
 * AU-13 mail ₪ — the ONE place `priceAlerts/**` turns integer agorot into text.
 *
 * INTERIM until G-13 (`moneyText` in @restomatch/types) merges: it wraps the
 * existing server twin of `formatIls()` (`formatIlsAgorot`, pinned by the web
 * money-parity test) in the same FSI…PDI isolates `moneyText` adds, so the ₪
 * stays glued to its digits inside Hebrew sentences. On G-13's merge this body
 * becomes `moneyText({ agorot }, { locale, context })` — one line, same bytes.
 *
 * `decimals`: 2 for unit prices ("₪6.20 ליחידה"), 0 for the ≈₪/month estimate.
 */
const FSI = '\u2068';
const PDI = '\u2069';

export type MailLocale = 'he' | 'en';

export function mailMoney(agorot: number, locale: MailLocale, decimals: 0 | 2): string {
  return FSI + formatIlsAgorot(agorot, { locale, maximumFractionDigits: decimals }) + PDI;
}

/**
 * Shekels (NUMERIC-derived) → integer agorot at the boundary: ONE half-up at
 * the agora. The decimal point is shifted in the text (`"1.005e2"` = 100.5),
 * never by a float multiply (1.005 × 100 = 100.4999… would round down).
 * Prices here are non-negative.
 */
export function toAgorot(ils: number | string): number {
  const s = String(Number(ils));
  return s.includes('e') ? Math.round(Number(ils) * 100) : Math.round(Number(`${s}e2`));
}
