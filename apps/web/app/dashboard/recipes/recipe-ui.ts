import { formatIls } from '@/lib/money';
import { formatPercent } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import type { BadgeTone } from '@/lib/components';

/**
 * Display helpers for the food-cost screens. The server returns integer agorot
 * and basis points (the cost engine's exact output); this is the ONLY place the
 * recipes UI turns them into ₪ / % text — through formatIls / formatPercent.
 */

export type Light = 'green' | 'amber' | 'red' | 'none';

/** Integer agorot → "₪12.34" (2 decimals: per-plate money is small). */
export function ils(agorot: number | null | undefined, locale: Locale, digits = 2): string {
  if (agorot == null) return '—';
  return formatIls(agorot / 100, { maximumFractionDigits: digits, locale });
}

/** Signed agorot delta → "+₪1.27" / "−₪2.10". */
export function ilsDelta(agorot: number | null | undefined, locale: Locale): string {
  if (agorot == null) return '—';
  if (agorot === 0) return ils(0, locale);
  const sign = agorot > 0 ? '+' : '−';
  return `${sign}${ils(Math.abs(agorot), locale)}`;
}

/** Basis points → "31.3%". */
export function pct(bp: number | null | undefined, locale: Locale): string {
  if (bp == null) return '—';
  return formatPercent(bp / 10_000, locale, 1);
}

/** NUMERIC(12,4) shekel price string → "₪38.90". */
export function priceText(price: string | null | undefined, locale: Locale): string {
  if (price == null) return '—';
  return formatIls(Number(price), { maximumFractionDigits: 2, locale });
}

export const LIGHT_TONE: Record<Light, BadgeTone> = {
  green: 'accent',
  amber: 'warning',
  red: 'danger',
  none: 'neutral',
};

/** Trim trailing zeros of a NUMERIC string for inputs ("0.1800" → "0.18"). */
export function trimDecimal(v: string | null | undefined): string {
  if (v == null) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

/* ── Unit picker (display only; the server validates conversions) ─────── */

function norm(u: string): string {
  return u.trim().toLowerCase().replace(/["'.\s׳״]/g, '');
}
const MASS = new Set(['mg', 'g', 'gr', 'גרם', 'kg', 'קג', 'קילו']);
const VOLUME = new Set(['ml', 'מל', 'cl', 'l', 'ליטר']);

/** Units a recipe line can use for an ingredient sold in `sourceUnit`. */
export function unitOptions(sourceUnit: string | null | undefined): string[] {
  const s = sourceUnit ? norm(sourceUnit) : '';
  if (MASS.has(s)) return uniq(['גרם', 'ק״ג', sourceUnit!]);
  if (VOLUME.has(s)) return uniq(['מ״ל', 'ליטר', sourceUnit!]);
  return uniq([sourceUnit ?? 'יח׳', 'יח׳', 'גרם', 'מ״ל']);
}

/** True when the line unit converts to the source unit without a manual bridge. */
export function convertsTo(unit: string, sourceUnit: string | null | undefined): boolean {
  if (!sourceUnit) return true;
  const a = norm(unit);
  const b = norm(sourceUnit);
  if (a === b) return true;
  return (MASS.has(a) && MASS.has(b)) || (VOLUME.has(a) && VOLUME.has(b));
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = norm(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "₪68" / "68.50" → integer agorot, or null when empty/invalid. */
export function shekelInputToAgorot(v: string): number | null {
  const clean = v.replace(/[₪\s,]/g, '');
  if (!clean) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return NaN;
  const [i, f = ''] = clean.split('.');
  return Number(i) * 100 + Number(f.padEnd(2, '0'));
}

export function agorotToInput(agorot: number | null | undefined): string {
  if (agorot == null) return '';
  const i = Math.floor(agorot / 100);
  const f = agorot % 100;
  return f === 0 ? String(i) : `${i}.${String(f).padStart(2, '0')}`;
}
