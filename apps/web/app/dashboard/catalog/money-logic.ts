import { parseNumberInput } from '@restomatch/types';

/**
 * Pure helpers for typed catalog prices and the import review (unit-tested).
 *
 * A typed price uses the one shared number parser (@restomatch/types
 * number-input), with the same options as an imported price-list cell:
 * "1,250" is 1250, "7,5" / "12,90" / "0,250" are comma decimals, "1,250.50"
 * groups thousands; a sign, letters or 5+ decimals are invalid, never guessed.
 */
export type PriceInput = number | null | 'invalid';

export function parsePriceInput(raw: string): PriceInput {
  const cell = parseNumberInput(raw, { scale: 4, grouping: true, negative: false });
  return cell.kind === 'ok' ? cell.value : cell.kind === 'empty' ? null : 'invalid';
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
