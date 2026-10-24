import { formatDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';

/** Storage areas in walk-through order (cold first, bar last). Mirrors the server's STORAGE_AREAS. */
export const AREAS = ['fridge', 'freezer', 'produce', 'dry', 'bar', 'other'] as const;
export type Area = (typeof AREAS)[number];

/** A local calendar date (YYYY-MM-DD) → "24 Oct 2026" / "24 באוק׳ 2026". Noon UTC is that date in Israel. */
export function dayText(ymd: string, locale: Locale): string {
  return formatDate(`${ymd}T12:00:00Z`, locale, { dateStyle: 'medium' });
}

/** What a person types on a phone keypad ("2,5", " 3 ") → the server's qty format, or null when invalid. */
export function normalizeQty(raw: string): string | null {
  const v = raw.trim().replace(',', '.');
  if (v === '') return '';
  return /^\d{1,8}(\.\d{1,4})?$/.test(v) ? v : null;
}

/** NUMERIC string → input text ("2.5000" → "2.5"). */
export function qtyText(v: string | null | undefined): string {
  if (v == null) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}
