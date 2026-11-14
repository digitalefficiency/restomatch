import { MONEY_DECIMALS, formatIlsPlain, type MoneyContext, type MoneyLocale } from './decimals';

/** U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE. */
export const FSI = '⁨';
export const PDI = '⁩';

export interface MoneyTextOptions {
  /** Default 'he'. */
  locale?: MoneyLocale;
  /** Required: the precision comes from where the figure sits, never from a silent default. */
  context: MoneyContext;
}

/**
 * The `<Money>` contract outside JSX (e-mail, WhatsApp, PDF, reports): integer
 * agorot (or shekels) → FSI + the `formatIls()` string at `MONEY_DECIMALS[context]` + PDI.
 *
 * The isolates keep "‏1,234.50 ₪" in one piece inside any surrounding text, so
 * the ₪ stays left of the digits in Hebrew whatever sits next to it (a supplier
 * name, a %, a date). Bidi marks inside the Intl string are never stripped.
 * Inside the isolates the bytes equal `formatIlsAgorot` / the web `formatIls`.
 * The PDF path runs the text through `visualOrder`, which drops the isolates.
 */
export function moneyText(input: { agorot: number } | { value: number }, opts: MoneyTextOptions): string {
  const shekels = 'agorot' in input ? input.agorot / 100 : input.value;
  return (
    FSI +
    formatIlsPlain(shekels, { locale: opts.locale, maximumFractionDigits: MONEY_DECIMALS[opts.context] }) +
    PDI
  );
}
