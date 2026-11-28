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

/**
 * Shekels (a NUMERIC string, or a NUMERIC-derived number) → integer agorot,
 * half-up at the agora (half away from zero, as `roundHalfUp` in recipes/cost.ts
 * and Intl's default): 1.005 → 101, 0.285 → 29, -1.005 → -101.
 *
 * Built from the decimal digits, never by multiplying floats: `Math.round(1.005 * 100)`
 * is 100 because 1.005 * 100 === 100.49999999999999. A number is read through its
 * shortest round-trip decimal string ("1.005"), the same digits Intl rounds.
 */
export function ilsToAgorot(ils: number | string): number {
  if (typeof ils === 'number') {
    if (!Number.isFinite(ils)) return ils * 100; // NaN / ±Infinity pass through, as before
    if (Math.abs(ils) >= 1e15) return Math.round(ils * 100); // beyond NUMERIC(12,2); no fraction left to round
  }
  const s = typeof ils === 'number' ? decimalDigits(ils) : ils.trim();
  const m = /^([-+])?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new RangeError(`ilsToAgorot: not a decimal amount: ${JSON.stringify(ils)}`);
  const frac = (m[3] ?? '').padEnd(3, '0');
  const agorot = Number(m[2]) * 100 + Number(frac.slice(0, 2)) + (frac[2]! >= '5' ? 1 : 0);
  return m[1] === '-' && agorot !== 0 ? -agorot : agorot;
}

/** The plain decimal digits of a finite number (no exponent): 1.005 → "1.005", 1e-7 → "0.0000001". */
function decimalDigits(n: number): string {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20) : s;
}
