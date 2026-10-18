/**
 * Server-side twin of the web's `formatIls()` (apps/web/lib/money.ts) for the
 * places the web util cannot reach: worker emails, WhatsApp text and the PDF
 * rendered in @restomatch/api. Same Intl options, same output — a parity test
 * in apps/web (lib/__tests__/money-parity.test.ts) pins the two together.
 * Input is INTEGER AGOROT; formatting happens only here, at display.
 */
export type ReportLocale = 'he' | 'en';

export function formatIlsAgorot(
  agorot: number,
  opts: { locale?: ReportLocale; maximumFractionDigits?: number } = {},
): string {
  return new Intl.NumberFormat(opts.locale === 'en' ? 'en-GB' : 'he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: opts.maximumFractionDigits ?? 0,
  }).format(agorot / 100);
}

/** 0.0163 → "1.6%" (one decimal, locale digits). */
export function formatPct(ratio: number | null, locale: ReportLocale = 'he'): string {
  if (ratio == null) return '—';
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'he-IL', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

/** Shekels from a NUMERIC-derived number → integer agorot (half-up at the agora). */
export function ilsToAgorot(ils: number): number {
  return Math.round(ils * 100);
}
