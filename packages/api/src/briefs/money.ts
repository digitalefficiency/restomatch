import { formatIlsAgorot } from '../reports/money';
import type { BriefLocale } from './types';

/**
 * The ONE place an AU-04 brief turns integer agorot into ₪ text. Interim: the
 * vetted server twin `formatIlsAgorot` (reports/money.ts, parity-tested against the
 * web `formatIls()`); it becomes G-13 `moneyText` in this one line when G-13 merges.
 */
export function briefIls(agorot: number, locale: BriefLocale = 'he'): string {
  return formatIlsAgorot(agorot, { locale });
}
