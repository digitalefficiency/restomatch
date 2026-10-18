import { intlLocaleOf, type Locale } from './i18n/config';

/**
 * Single source of truth for ₪ (ILS) display.
 *
 * All shekel rendering in the web app goes through here — never re-implement
 * `new Intl.NumberFormat('he-IL', { currency: 'ILS' })` inline (that drift is
 * how the dashboard ended up formatting the same money with 0 vs 2 decimals).
 * Owned by the money-format-marshal (AGENTS.md).
 *
 * `maximumFractionDigits` defaults to 0 for clean headline ₪; pass 2 for precise
 * tables where the agora matters. `locale` defaults to Hebrew (output unchanged);
 * pass the active locale from `useLocale()` / `getLocale()` on English screens
 * (`₪1,234` instead of `‏1,234 ₪`).
 */
export function formatIls(
  value: number,
  opts: { maximumFractionDigits?: number; locale?: Locale } = {},
): string {
  return new Intl.NumberFormat(intlLocaleOf(opts.locale ?? 'he'), {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: opts.maximumFractionDigits ?? 0,
  }).format(value);
}
