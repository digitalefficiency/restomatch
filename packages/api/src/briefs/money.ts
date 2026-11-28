import { formatIlsAgorot } from '../reports/money';
import type { BriefLocale } from './types';

/**
 * The ONE place an AU-04 brief turns integer agorot into ₪ text. Interim: the
 * vetted server twin `formatIlsAgorot` (reports/money.ts, parity-tested against the
 * web `formatIls()`); it becomes G-13 `moneyText` in this one line when G-13 merges.
 */
export function briefIls(agorot: number, locale: BriefLocale = 'he', opts: { agorot?: boolean } = {}): string {
  // `agorot`: the per-invoice claim precision of W2-04's first-match alert (up to 2
  // decimals), so a ₪0.40 claim never prints as "₪0".
  return formatIlsAgorot(agorot, { locale, ...(opts.agorot ? { maximumFractionDigits: 2 } : {}) });
}
