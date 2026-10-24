import type { Locale } from '@/lib/i18n/config';

/** Pure order-screen helpers (unit-tested in app/dashboard/__tests__). */

/**
 * Wrap an LTR value (email, phone) in Unicode isolates (LRI … PDI) so it keeps
 * its own direction inside Hebrew text — e.g. a native <option> label, where
 * markup can't set `dir` and the bidi algorithm otherwise scrambles the brackets.
 */
export function ltrIsolate(value: string): string {
  return `\u2066${value}\u2069`;
}

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

export type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
export type ReceiptStatus = 'pending' | 'partial' | 'completed' | 'rejected' | null;
/** What the order screens show: the stored PO status, or the goods receipt's state for an open PO. */
export type DisplayOrderStatus = PoStatus | 'received';

/**
 * An open PO (sent / confirmed / partial) shows its delivery state from the latest goods
 * receipt: a completed receipt reads "received", a partial one "partially received".
 * Receiving never changes the stored PO status (invoice matching still needs to find the PO),
 * so without this a delivered order kept reading "sent".
 */
export function deliveryStatusOf(status: PoStatus, receipt: ReceiptStatus | undefined): DisplayOrderStatus {
  if (status !== 'sent' && status !== 'confirmed' && status !== 'partial') return status;
  if (receipt === 'completed') return 'received';
  if (receipt === 'partial') return 'partial';
  return status;
}
