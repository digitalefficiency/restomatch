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

/**
 * The order reference the supplier receives ("מס׳ הזמנה: F8E05686"): the first 8 hex
 * digits of the PO id, upper-case. Mirrors `poRefOf` in packages/api
 * (supplierMessage.ts) — the parity is unit-tested.
 */
export function poRefOf(poId: string): string {
  return poId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Lines the estimated total can't include (no price yet) — said next to the total, never shown as ₪0. */
export function unpricedCount(lines: Array<{ unitPriceExpected?: number | string | null }>): number {
  return lines.filter((l) => l.unitPriceExpected == null || l.unitPriceExpected === '').length;
}

/**
 * Orders-list search: supplier name (he / en) or the PO ref, with or without "#".
 * Case- and space-insensitive; an empty query matches everything.
 */
export function matchesOrderSearch(
  o: { id: string; supplierName: string; supplierNameEn?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
  if (!q) return true;
  if (poRefOf(o.id).toLowerCase().startsWith(q.replace(/\s/g, ''))) return true;
  return [o.supplierName, o.supplierNameEn ?? ''].some((n) => n.toLowerCase().includes(q));
}

/**
 * An Israeli phone as wa.me wants it: digits only, local 0-prefix → 972.
 * Returns null when nothing dialable is left.
 */
export function waPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

/** A wa.me deep link with prefilled text (to a number when known, else the share picker). */
export function waLink(phone: string | null | undefined, text: string): string {
  const p = waPhone(phone);
  return `https://wa.me/${p ?? ''}?text=${encodeURIComponent(text)}`;
}

/** mailto: with subject + body (the supplier's own mail app — nothing is queued by us). */
export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface ReorderSourceLine {
  productId: string | null;
  rawDescription: string | null;
  qtyOrdered: string | number;
  unit: string;
  unitPriceExpected: string | number | null;
}

export interface ReorderCatalogItem {
  productId: string | null;
  listPrice: string | number | null;
  active?: boolean | null;
}

export interface ReorderLine {
  productId?: string;
  rawDescription: string;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
  /** Where the price came from — shown on the review so a changed price is never silent. */
  priceSource: 'contract' | 'catalog' | 'last' | 'none';
}

/**
 * "Order again": the lines of a past PO, re-priced for today.
 *  - a catalog product line takes today's contract price, else the catalog list
 *    price, else the price it was last ordered at;
 *  - a free-text line (no product) is copied verbatim, at its last price;
 *  - a product the supplier no longer lists (the catalog is known and the product
 *    isn't in it) is NOT added — it comes back in `unavailable` so the screen can
 *    name it. With no catalog at all every line is kept (nothing to check against).
 */
export function reorderLines(
  source: ReorderSourceLine[],
  catalog: ReorderCatalogItem[],
  contractPrice: (productId: string, unit: string) => number | undefined,
  /** False when the catalog page was capped: a product missing from it may still be listed. */
  catalogComplete = true,
): { lines: ReorderLine[]; unavailable: string[] } {
  const listed = new Map<string, number | undefined>();
  for (const c of catalog) {
    if (!c.productId || c.active === false) continue;
    const price = c.listPrice == null || c.listPrice === '' ? undefined : Number(c.listPrice);
    listed.set(c.productId, Number.isFinite(price) ? price : undefined);
  }
  const knowCatalog = listed.size > 0;
  const lines: ReorderLine[] = [];
  const unavailable: string[] = [];
  for (const l of source) {
    const qty = Number(l.qtyOrdered);
    const name = l.rawDescription?.trim() ?? '';
    const last = l.unitPriceExpected == null || l.unitPriceExpected === '' ? undefined : Number(l.unitPriceExpected);
    if (!(qty > 0)) continue;
    if (l.productId) {
      if (knowCatalog && catalogComplete && !listed.has(l.productId)) {
        unavailable.push(name || '—');
        continue;
      }
      const contract = contractPrice(l.productId, l.unit);
      const list = listed.get(l.productId);
      const [unitPriceExpected, priceSource] =
        contract !== undefined
          ? [contract, 'contract' as const]
          : list !== undefined
            ? [list, 'catalog' as const]
            : last !== undefined && Number.isFinite(last)
              ? [last, 'last' as const]
              : [undefined, 'none' as const];
      lines.push({ productId: l.productId, rawDescription: name, qty, unit: l.unit, unitPriceExpected, priceSource });
    } else if (name) {
      const ok = last !== undefined && Number.isFinite(last);
      lines.push({
        rawDescription: name,
        qty,
        unit: l.unit,
        unitPriceExpected: ok ? last : undefined,
        priceSource: ok ? 'last' : 'none',
      });
    }
  }
  return { lines, unavailable };
}

/**
 * The cancel notice for the supplier (Hebrew: it goes to an Israeli supplier
 * whatever the UI language). Names the order ref, the delivery day and the sender.
 */
export function cancelNoticeText(input: {
  supplierName: string;
  poRef: string;
  deliveryLabel: string | null;
  restaurantName: string;
}): { subject: string; body: string } {
  const subject = `ביטול הזמנה ${input.poRef}`;
  const body = [
    `שלום ${input.supplierName},`,
    `נא לבטל את הזמנה מס׳ ${input.poRef}${input.deliveryLabel ? ` (אספקה ${input.deliveryLabel})` : ''}.`,
    'תודה,',
    input.restaurantName,
  ]
    .filter(Boolean)
    .join('\n');
  return { subject, body };
}
