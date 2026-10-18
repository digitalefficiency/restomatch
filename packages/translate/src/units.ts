import { hasHebrew, matchKey } from './normalize';

/**
 * Hebrew unit-of-measure / pack-type → short English label, keyed by matchKey()
 * (so ק״ג, ק"ג, קג and ק.ג all resolve). Labels are what a receiver reads next
 * to a quantity: "12 kg", "4 case".
 */
const UNIT_ENTRIES: ReadonlyArray<readonly [string[], string]> = [
  [['ק"ג', 'קג', 'ק.ג', 'ק.ג.', 'קילו', 'קילוגרם', 'קילוגרמים', 'קלג'], 'kg'],
  [["גר'", 'גר', 'גרם', 'גרמים', "ג'", 'ג', 'גר.'], 'g'],
  [["מ\"ג", 'מג', 'מיליגרם'], 'mg'],
  [["ל'", 'ל', 'ליטר', 'ליטרים', 'לי', 'ליט'], 'L'],
  [["מ\"ל", 'מל', 'מיליליטר', 'מ.ל'], 'ml'],
  [["יח'", 'יח', 'יחידה', 'יחידות', 'יח.', "יח'ה", 'פריט', 'פריטים', "פר'"], 'unit'],
  [['ארגז', 'ארגזים', "ארג'", 'ארג'], 'case'],
  [['קרטון', 'קרטונים', "קרט'", 'קרט'], 'carton'],
  [['מארז', 'מארזים', "מאר'"], 'pack'],
  [['שק', 'שקים', 'שקי'], 'sack'],
  [['שקית', 'שקיות'], 'bag'],
  [['בקבוק', 'בקבוקים', "בקב'", 'בקב'], 'bottle'],
  [['פחית', 'פחיות'], 'can'],
  [['צנצנת', 'צנצנות'], 'jar'],
  [['דלי', 'דליים'], 'bucket'],
  [['תבנית', 'תבניות'], 'tray'],
  [['מגש', 'מגשים'], 'tray'],
  [['חבילה', 'חבילות', "חב'", 'חב'], 'package'],
  [['קופסה', 'קופסא', 'קופסאות', 'קופסות', "קופ'"], 'box'],
  [['גליל', 'גלילים'], 'roll'],
  [['צרור', 'צרורות', 'אגד', 'אגודה', 'אגודות'], 'bunch'],
  [['ראש', 'ראשים'], 'head'],
  [['תריסר', 'תריסרים'], 'dozen'],
  [['זוג', 'זוגות'], 'pair'],
  [['מיכל', 'מיכלים'], 'container'],
  [["ג'ריקן", 'גריקן', "ג'ריקנים"], 'jerrycan'],
  [['חבית', 'חביות'], 'keg'],
  [['משטח', 'משטחים'], 'pallet'],
  [['טון'], 't'],
  [['מטר', 'מטרים', "מ'"], 'm'],
  [["ס\"מ", 'סמ'], 'cm'],
  [['מנה', 'מנות'], 'portion'],
  [['פרוסה', 'פרוסות'], 'slice'],
  [['כיכר', 'כיכרות'], 'loaf'],
  [['שרוול', 'שרוולים'], 'sleeve'],
];

const UNIT_MAP: ReadonlyMap<string, string> = new Map(
  UNIT_ENTRIES.flatMap(([keys, en]) => keys.map((k) => [matchKey(k).replace(/\./g, ''), en] as const)),
);

function unitKey(unit: string): string {
  return matchKey(unit).replace(/\./g, '').trim();
}

/** Is this token a known Hebrew unit? */
export function isHebrewUnit(token: string): boolean {
  return UNIT_MAP.has(unitKey(token));
}

/**
 * Translate a unit as printed on an invoice / PO line. Returns the English
 * label, the input unchanged when it is already non-Hebrew ("kg", "L"), or
 * null when it is Hebrew we don't know (callers then show the original).
 */
export function translateUnit(unit: string | null | undefined): string | null {
  if (unit == null) return null;
  const trimmed = unit.trim();
  if (trimmed === '') return null;
  if (!hasHebrew(trimmed)) return trimmed;
  return UNIT_MAP.get(unitKey(trimmed)) ?? null;
}

/** Display helper: English unit, falling back to the original text. */
export function unitLabel(unit: string | null | undefined, locale: 'he' | 'en'): string {
  if (unit == null) return '';
  if (locale === 'he') return unit;
  return translateUnit(unit) ?? unit;
}
