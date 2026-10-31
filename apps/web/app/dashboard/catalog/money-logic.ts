/**
 * Pure helpers for typed catalog prices and the import review (unit-tested).
 *
 * A typed price follows the same strict rules as an imported price-list cell
 * (packages/api lib/parseMoneyCell, auto mode — a parity test pins them):
 * "1,250" is 1250, "7,5" and "12,90" are comma decimals, "1,250.50" groups
 * thousands; a sign, letters or "1,2345" are invalid, never guessed.
 */
export type PriceInput = number | null | 'invalid';

export function parsePriceInput(raw: string): PriceInput {
  const s = raw.replace(/₪/g, '').replace(/[\s  ‎‏]/g, '');
  if (s === '') return null;
  let norm: string | null = null;
  if (/^\d+(?:\.\d+)?$/.test(s)) norm = s;
  else if (/^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(s)) norm = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s) || /^0,\d+$/.test(s)) norm = s.replace(',', '.');
  if (norm === null) return 'invalid';
  const n = Number(norm);
  return Number.isFinite(n) ? n : 'invalid';
}

/** The value a price input shows after blur: "7,5" → "7.50", "1,250" → "1250.00" (re-parses to itself). */
export function formatPriceInput(raw: string): string {
  const v = parsePriceInput(raw);
  if (typeof v !== 'number') return raw;
  const fixed = v.toFixed(Math.max(2, (String(v).split('.')[1] ?? '').length));
  return fixed.length > 2 ? fixed : raw;
}

/** A matcher score as a word — never a % (the score is lexical, not a probability; catalog-50). */
export type ConfidenceWord = 'high' | 'medium' | 'low';
export function confidenceWord(confidence: number): ConfidenceWord {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.75) return 'medium';
  return 'low';
}

/** Why the matcher suggested the product, in the order shown ("שם דומה · אותו ספק · אותה יחידה"). */
export type BasisKey =
  | 'sku'
  | 'barcode'
  | 'alias'
  | 'name'
  | 'sameSupplier'
  | 'sameUnit'
  | 'otherUnit'
  | 'otherPack';
export function suggestionBasis(s: {
  matchedBy: string;
  unit: string | null;
  productUnit: string | null;
  reasons: string[];
}): BasisKey[] {
  const out: BasisKey[] = [];
  if (s.matchedBy === 'sku') out.push('sku');
  else if (s.matchedBy === 'barcode') out.push('barcode');
  else if (s.matchedBy === 'alias') out.push('alias');
  else out.push('name');
  // matchProductTopN only ever suggests a product this supplier already sells.
  out.push('sameSupplier');
  if (s.reasons.includes('UNIT_MISMATCH')) out.push('otherUnit');
  else if (s.unit && s.productUnit) out.push('sameUnit');
  if (s.reasons.includes('PACK_MISMATCH')) out.push('otherPack');
  return out;
}

/** "Ctrl/⌘+S" by physical key — `e.key` is "ד" on a Hebrew layout (catalog-40). */
export function isSaveShortcut(e: { ctrlKey: boolean; metaKey: boolean; code: string }): boolean {
  return (e.ctrlKey || e.metaKey) && e.code === 'KeyS';
}
