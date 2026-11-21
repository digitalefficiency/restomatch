/**
 * W3-10 · catalog / products search. The Hebrew normaliser is W3-04a's shared
 * `normalizeHe` (niqqud, final letters, geresh/gershayim, bidi marks, dashes and
 * whitespace); this module adds only the catalog ranking (barcode > SKU > name
 * prefix > every word) on top of it.
 */
import { normalizeHe } from '@/lib/components/palette/normalizeHe';

export function normalizeForSearch(raw: string): string {
  return normalizeHe(raw);
}

export interface Searchable {
  name: string;
  aliases?: string[];
  supplierSku?: string | null;
  barcodeEan?: string | null;
}

/** A query of 8–14 digits is a barcode (EAN-8 / UPC-A / EAN-13 / GTIN-14). */
export function isBarcodeQuery(q: string): boolean {
  return /^\d{8,14}$/.test(q.replace(/\s/g, ''));
}

/**
 * Score 0 = no match. Barcode exact > SKU exact > name/alias prefix > every
 * query word found. Higher is better; ties keep the caller's order.
 */
export function matchScore(item: Searchable, query: string): number {
  const q = normalizeForSearch(query);
  if (!q) return 0;
  const digits = query.replace(/\s/g, '');
  if (isBarcodeQuery(digits)) return item.barcodeEan?.replace(/\s/g, '') === digits ? 100 : 0;
  if (item.supplierSku && normalizeForSearch(item.supplierSku) === q) return 90;
  const words = q.split(' ');
  let best = 0;
  for (const text of [item.name, ...(item.aliases ?? [])]) {
    const t = normalizeForSearch(text);
    if (!t) continue;
    if (t === q) best = Math.max(best, 80);
    else if (t.startsWith(q)) best = Math.max(best, 70);
    else if (words.every((w) => t.split(' ').some((tw) => tw.startsWith(w)))) best = Math.max(best, 50);
    else if (words.every((w) => t.includes(w))) best = Math.max(best, 30);
  }
  return best;
}

export function searchItems<T extends Searchable>(items: T[], query: string): T[] {
  if (!normalizeForSearch(query) && !isBarcodeQuery(query)) return items;
  return items
    .map((item, i) => ({ item, i, s: matchScore(item, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
