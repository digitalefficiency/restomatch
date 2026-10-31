/**
 * Server-side twin of the web's `formatIls()` (apps/web/lib/money.ts) for the
 * places the web util cannot reach: worker emails, WhatsApp text and the PDF
 * rendered in @restomatch/api. Same Intl options, same output — a parity test
 * in apps/web (lib/__tests__/money-parity.test.ts) pins the two together.
 * Input is INTEGER AGOROT; formatting happens only here, at display.
 */
import { formatIlsPlain } from '@restomatch/types';

export type ReportLocale = 'he' | 'en';

/**
 * Signature and 0-dp default unchanged (G-13): the Intl options now come from
 * @restomatch/types `formatIlsPlain`, the one currency site the server shares.
 * New code prefers `moneyText({ agorot }, { locale, context })` (isolated,
 * precision by context — the context is required there).
 */
export function formatIlsAgorot(
  agorot: number,
  opts: { locale?: ReportLocale; maximumFractionDigits?: number } = {},
): string {
  return formatIlsPlain(agorot / 100, { locale: opts.locale, maximumFractionDigits: opts.maximumFractionDigits ?? 0 });
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
