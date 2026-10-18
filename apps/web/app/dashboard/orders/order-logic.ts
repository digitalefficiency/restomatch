import type { Locale } from '@/lib/i18n/config';

/** Pure order-screen helpers (unit-tested in app/dashboard/__tests__). */

/** Strict positive number from a text input ('' / 0 / negative / NaN → null). */
export function parsePositive(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Optional non-negative price: '' → null (clear), bad input → 'invalid'. */
export function parsePrice(raw: string): number | null | 'invalid' {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

/**
 * What to call an order line in the active locale. English prefers the
 * product's English name, then the line's English rendering (0028), and keeps
 * the Hebrew original as secondary text so it can be matched to the paper.
 */
export function lineLabel(
  l: { rawDescription: string | null; rawDescriptionEn?: string | null; productNameEn?: string | null },
  locale: Locale,
): { primary: string; secondary: string | null } {
  const he = l.rawDescription?.trim() || '—';
  if (locale !== 'en') return { primary: he, secondary: null };
  const en = l.productNameEn?.trim() || l.rawDescriptionEn?.trim();
  if (!en) return { primary: he, secondary: null };
  return { primary: en, secondary: en === he ? null : he };
}

export interface DraftLineLike {
  key: string;
  productId?: string;
  rawDescription: string;
  qty: number;
}

/**
 * Add a catalog item to the order being built. Picking the same product (or the
 * same free-text description) again bumps the quantity instead of creating a
 * duplicate line. Returns the new list and whether it merged.
 */
export function addOrMerge<T extends DraftLineLike>(
  lines: T[],
  next: Omit<T, 'key'>,
  makeKey: () => string,
): { lines: T[]; merged: boolean } {
  const idx = lines.findIndex((l) =>
    next.productId ? l.productId === next.productId : !l.productId && l.rawDescription === next.rawDescription,
  );
  if (idx >= 0) {
    const copy = lines.slice();
    const cur = copy[idx]!;
    copy[idx] = { ...cur, qty: cur.qty + (next.qty || 1) };
    return { lines: copy, merged: true };
  }
  return { lines: [...lines, { ...next, key: makeKey() } as T], merged: false };
}

/** A draft can go to review when every line has a description and qty > 0. */
export function linesValid(lines: Array<{ rawDescription: string; qty: number; unit: string }>): boolean {
  return (
    lines.length > 0 &&
    lines.every((l) => l.rawDescription.trim().length > 0 && l.qty > 0 && l.unit.trim().length > 0)
  );
}

/** Agorot-exact line total for display (qty × price, half-up to the agora). */
export function lineTotalIls(qty: number, price: number | undefined): number {
  if (price == null || !Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return Math.round(qty * price * 100 + 1e-9) / 100;
}

/** Sum of line totals, summed in integer agorot. */
export function orderTotalIls(lines: Array<{ qty: number; unitPriceExpected?: number }>): number {
  return lines.reduce((sum, l) => sum + Math.round(lineTotalIls(l.qty, l.unitPriceExpected) * 100), 0) / 100;
}

/** Keys of `orders.unitNames` — the common units a free-text line may carry. */
export type UnitKey =
  | 'kg' | 'gram' | 'liter' | 'ml' | 'unit' | 'box' | 'pack'
  | 'bottle' | 'barrel' | 'sixPack' | 'can' | 'bag' | 'tray' | 'bunch';

const UNIT_ALIASES: Record<string, UnitKey> = {
  'ק״ג': 'kg', 'ק"ג': 'kg', 'קג': 'kg', 'קילו': 'kg', kg: 'kg',
  'גרם': 'gram', 'גר׳': 'gram', 'גר': 'gram', g: 'gram',
  'ליטר': 'liter', 'ל׳': 'liter', l: 'liter',
  'מ״ל': 'ml', 'מ"ל': 'ml', ml: 'ml',
  'יח׳': 'unit', "יח'": 'unit', 'יחידה': 'unit', 'יחידות': 'unit', 'יח': 'unit', unit: 'unit', pcs: 'unit',
  'ארגז': 'box', 'קרטון': 'box', 'קופסה': 'box', box: 'box',
  'מארז': 'pack', 'חבילה': 'pack', pack: 'pack',
  'בקבוק': 'bottle', 'בקבוקים': 'bottle',
  'חבית': 'barrel',
  'שישייה': 'sixPack', 'שישיה': 'sixPack',
  'פחית': 'can', 'פחיות': 'can',
  'שק': 'bag', 'שקית': 'bag',
  'מגש': 'tray', 'תבנית': 'tray',
  'צרור': 'bunch',
};

/** Normalise a free-text unit to a known key (null → show the original text). */
export function unitKey(raw: string | null | undefined): UnitKey | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[k] ?? null;
}
