/**
 * Hebrew text normalization shared by the glossary and the unit map.
 *
 * Invoices spell the same word many ways: gershayim as ״ / " / ” / '' , geresh
 * as ׳ / ' / ’ , optional niqqud, maqaf (־) or a hyphen between words. The
 * matching key strips all of that so one glossary entry covers every variant.
 */

const NIQQUD = /[֑-ׇ]/g; // cantillation + vowel points (maqaf handled below)
const MAQAF = /־/g;
const GERSHAYIM = /[״“”„‟]|''/g;
const GERESH = /[׳‘’‚‛`´]/g;

export const HEBREW_LETTER = /[א-ת]/;
const HEBREW_LETTER_G = /[א-ת]/g;
const LATIN_LETTER = /[A-Za-z]/;

/** Canonical display form: unify quote marks, drop niqqud, collapse spaces. */
export function normalizeHebrew(text: string): string {
  return text
    .replace(MAQAF, ' ')
    .replace(GERSHAYIM, '"')
    .replace(GERESH, "'")
    .replace(NIQQUD, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matching key: normalized, with quote marks removed (ק״ג ≡ ק"ג ≡ קג). */
export function matchKey(text: string): string {
  return normalizeHebrew(text).replace(/["']/g, '').toLowerCase();
}

export function hasHebrew(text: string): boolean {
  return HEBREW_LETTER.test(text);
}

export function hasLatin(text: string): boolean {
  return LATIN_LETTER.test(text);
}

/** Share of letters that are Hebrew (0..1); 0 for text without letters. */
export function hebrewRatio(text: string): number {
  const he = text.match(HEBREW_LETTER_G)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return he + latin === 0 ? 0 : he / (he + latin);
}
