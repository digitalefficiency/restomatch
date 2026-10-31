/**
 * The ₪ display contract shared by every channel (screen, e-mail, WhatsApp,
 * PDF, reports): the precision by context and the ONE Intl currency formatter
 * outside the frozen web `formatIls()` (apps/web/lib/money.ts), whose options
 * it repeats exactly so both print the same bytes (pinned by
 * apps/web/lib/__tests__/money-parity.test.ts through `formatIlsAgorot`).
 *
 * Client-safe: Intl only, no Node APIs (this package is bundled into web code).
 */
export type MoneyLocale = 'he' | 'en';

export type MoneyContext = 'hero' | 'tile' | 'line' | 'unit' | 'inline';

/** Precision contract (B3): hero/tile/inline 0 dp · line 2 dp · unit 4 dp. Mirrors the web `<Money>`. */
export const MONEY_DECIMALS: Readonly<Record<MoneyContext, number>> = Object.freeze({
  hero: 0,
  tile: 0,
  inline: 0,
  line: 2,
  unit: 4,
});

/** The Intl locale for a UI locale (same mapping as the web's `intlLocaleOf`). */
export function moneyIntlLocale(locale: MoneyLocale = 'he'): string {
  return locale === 'en' ? 'en-GB' : 'he-IL';
}

export interface IlsFormatOptions {
  locale?: MoneyLocale;
  /** Default 0 (whole shekels), as `formatIls()`. */
  maximumFractionDigits?: number;
  /** Omitted = Intl's default (as `formatIls()`); set it only to pin trailing zeros. */
  minimumFractionDigits?: number;
}

/**
 * Shekels → the plain Intl currency string ("‏1,234 ₪" / "₪1,234"), with no
 * isolation. The single Intl currency site for @restomatch/types, api and
 * worker. Prefer `moneyText` (isolated, precision by context) in new code.
 */
export function formatIlsPlain(shekels: number, opts: IlsFormatOptions = {}): string {
  const o: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: opts.maximumFractionDigits ?? 0,
  };
  if (opts.minimumFractionDigits !== undefined) o.minimumFractionDigits = opts.minimumFractionDigits;
  return new Intl.NumberFormat(moneyIntlLocale(opts.locale), o).format(shekels);
}
