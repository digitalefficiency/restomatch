/**
 * Hebrew search normalizer (W3-04, published day 1 for W3-10). Pure, no deps,
 * edge-safe. Fold a query and a label the same way, then compare with
 * `includes` / `startsWith`:
 *
 * - case (Latin) and Unicode compatibility forms (NFKD: שׁ U+FB2A → ש + dot);
 * - niqqud and cantillation (U+0591–U+05C7) are dropped; maqaf, paseq and
 *   sof pasuq become a space;
 * - geresh / gershayim (׳ ״) and ASCII / typographic quotes are dropped, so
 *   צ׳יפס = צ'יפס = ציפס and ק״ג = ק"ג = קג;
 * - final letters fold to their regular form (ך→כ ם→מ ן→נ ף→פ ץ→צ);
 * - bidi / zero-width marks are dropped; dashes, underscores and every kind
 *   of whitespace (NBSP included) collapse to one space; trimmed.
 */
export function normalizeHe(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[־׀׃]/g, ' ')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳״'"`‘’‚‛“”„′″]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c)
    .replace(/[\s _\-‐-―]+/g, ' ')
    .trim();
}

const FINALS: Readonly<Record<string, string>> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

/** Israeli standard keyboard (SI-1452): the Hebrew letter on each Latin key. */
const LATIN_TO_HE: Readonly<Record<string, string>> = {
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ', ',': 'ת', '.': 'ץ', '/': '.',
};

const HE_TO_LATIN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LATIN_TO_HE)
    .filter(([, he]) => /[א-ת]/.test(he))
    .map(([latin, he]) => [he, latin]),
);

/**
 * Wrong layout, typed on EN meaning HE: "akuo" → "שלום". Returns null when the
 * input has no Latin letter (nothing to re-map).
 */
export function heFromLatinLayout(input: string): string | null {
  if (!/[a-z]/i.test(input)) return null;
  return Array.from(input.toLowerCase(), (c) => LATIN_TO_HE[c] ?? c).join('');
}

/**
 * Wrong layout, typed on HE meaning EN: "םרגקרד" → "orders". Returns null when
 * the input has no Hebrew letter.
 */
export function latinFromHeLayout(input: string): string | null {
  if (!/[א-ת]/.test(input)) return null;
  return Array.from(input, (c) => HE_TO_LATIN[c] ?? c).join('');
}

/**
 * The normalized forms a query should be matched as: the query itself first,
 * then its wrong-layout re-mapping (if any). De-duplicated, empties dropped.
 */
export function searchVariants(query: string): string[] {
  const out = [normalizeHe(query)];
  const he = heFromLatinLayout(query);
  if (he) out.push(normalizeHe(he));
  const en = latinFromHeLayout(query);
  if (en) out.push(normalizeHe(en));
  return [...new Set(out.filter(Boolean))];
}

/** True when `haystack` contains any variant of `query` (after `normalizeHe`). */
export function matchesHe(haystack: string, query: string): boolean {
  const h = normalizeHe(haystack);
  return searchVariants(query).some((v) => h.includes(v));
}
