/**
 * The product's own number pad at the dock (DS3-05, SPEC §10.3): the same Latin
 * digits and the same decimal point in all six receiver languages. A phone's own
 * keyboard follows the device language (ar-IL, for one, defaults to Arabic-Indic
 * digits), so the quantity sheet never opens it.
 *
 * Pure — unit-tested (__tests__/keypad.test.ts). The typed text is parsed with
 * the wizard's one quantity parser (qtyEntry.parseQty), never a second rule.
 */
import { parseQty, qtyInputText, qtyKind, roundQty } from '@/app/showcase/receiver/_steps/qtyEntry';
import { translateUnit } from '@restomatch/translate/units';

/** The 3 × 4 grid, in reading order: digits, then the point, 0 and delete. */
export const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;
export type PadKey = (typeof PAD_KEYS)[number];

/** Digits before the point. gr_lines.qty_received is numeric(12,3); grams can run to five digits. */
export const PAD_MAX_INT = 7;
/** Digits after the point: the database keeps three. */
export const PAD_MAX_DEC = 3;

/**
 * One key on the pad. `replace`: the text on screen was put there for the
 * receiver (the ordered quantity, an earlier count, a quick choice or a step)
 * and reads as selected, so the first key replaces it instead of being appended
 * to it. `whole`: an item counted in whole units takes no decimal point.
 */
export function typeKey(text: string, key: PadKey, replace = false, whole = false): string {
  if (key === 'del') return replace ? '' : text.slice(0, -1);
  if (key === '.' && whole) return text;
  const t = replace ? '' : text;
  const dot = t.indexOf('.');
  if (key === '.') return dot >= 0 ? t : `${t || '0'}.`;
  if (t === '0') return key;
  if (dot < 0 ? t.length >= PAD_MAX_INT : t.length - dot - 1 >= PAD_MAX_DEC) return t;
  return t + key;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/**
 * A hardware key (a tablet keyboard, a desk, a screen-reader user) as a pad key:
 * Latin, Arabic-Indic or Persian digits, a point or a comma, Backspace.
 */
export function padKeyFromKeyboard(key: string): PadKey | null {
  if (/^[0-9]$/.test(key)) return key as PadKey;
  const ar = ARABIC_INDIC.indexOf(key);
  if (ar >= 0) return String(ar) as PadKey;
  const fa = PERSIAN.indexOf(key);
  if (fa >= 0) return String(fa) as PadKey;
  if (key === '.' || key === ',' || key === '٫') return '.';
  if (key === 'Backspace') return 'del';
  return null;
}

/**
 * What a hardware keyboard (or a pasted value, or a test's fill) put into the
 * quantity field, kept to the pad's own rule: Latin digits (Arabic-Indic and
 * Persian digits are read as such), one point (a comma is a point; none for an
 * item counted in whole units), at most PAD_MAX_INT digits before it and
 * PAD_MAX_DEC after, no leading zeros. null = not a quantity text; the field
 * keeps what it had.
 */
export function sanitizeTyped(raw: string, whole = false): string | null {
  let s = '';
  for (const ch of raw.trim()) {
    const ar = ARABIC_INDIC.indexOf(ch);
    const fa = PERSIAN.indexOf(ch);
    if (ar >= 0) s += String(ar);
    else if (fa >= 0) s += String(fa);
    else if (ch === ',' || ch === '٫') s += '.';
    else s += ch;
  }
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const dot = s.indexOf('.');
  if (dot >= 0 && whole) return null;
  const int = (dot < 0 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const dec = dot < 0 ? null : s.slice(dot + 1);
  if (int.length > PAD_MAX_INT || (dec !== null && dec.length > PAD_MAX_DEC)) return null;
  return dec === null ? int : `${int || '0'}.${dec}`;
}

/** The typed text as a quantity; null while it is empty or only a point. */
export function padValue(text: string): number | null {
  return parseQty(text);
}

/** Units weighed or measured in amounts a half-step suits (kg, litre, tonne, metre). */
const HALF_STEP = new Set(['kg', 'L', 't', 'm']);

/**
 * The − / + of the sheet, a small correction (SPEC §10.3): one for an item
 * counted in units, a half for kilos and litres. Grams, millilitres and the
 * like have no stepper (a half gram is no correction); null = none.
 */
export function padStep(unit: string | null | undefined): number | null {
  if (qtyKind(unit) === 'counted') return 1;
  const en = translateUnit(unit ?? null);
  return en && HALF_STEP.has(en) ? 0.5 : null;
}

/**
 * The units translateUnit names that are counted, never weighed or measured (units, cases,
 * cartons, packs …): an item in one of these comes in whole pieces.
 */
const WHOLE_UNITS = new Set([
  'unit', 'case', 'carton', 'pack', 'sack', 'bag', 'bottle', 'can', 'jar', 'bucket', 'tray', 'package', 'box', 'roll',
  'bunch', 'head', 'dozen', 'pair', 'container', 'jerrycan', 'keg', 'six-pack', 'pallet', 'portion', 'slice', 'loaf', 'sleeve',
]);

/**
 * An item counted in whole units: the pad's point is off (the reference: a step of one). Only a
 * unit known to be counted, ordered in a whole number: an unknown unit ("KG" typed in Latin, a word
 * the table lacks) or half a case on the order keeps the point, as today's entry accepts a decimal
 * for every unit.
 */
export function isWhole(unit: string | null | undefined, ordered?: number | null): boolean {
  const en = translateUnit(unit ?? null)?.toLowerCase();
  if (!en || !WHOLE_UNITS.has(en)) return false;
  return ordered == null || Number.isInteger(roundQty(ordered));
}

/** One step of the − / +: never below zero. */
export function stepText(text: string, delta: number): string {
  const next = Math.max(0, roundQty((padValue(text) ?? 0) + delta));
  return qtyInputText(next);
}

/**
 * What the sheet shows when it opens. A line already counted shows its count
 * (selected, so the first key replaces it). A line nobody counted shows the
 * ordered quantity, selected, as today (the wizard pre-fills it); an item that
 * is not on the order opens empty (nothing is assumed to have arrived); and
 * every line opens empty when the restaurant counts blind (flag
 * `dockCountFirst`): the receiver writes what is on the dock.
 */
export function initialPadText(mark: { touched: boolean; qtyReceived: number; rejectReason?: string | null }, blind: boolean): string {
  if (mark.touched) return mark.rejectReason === 'missing' ? '0' : qtyInputText(mark.qtyReceived);
  return blind || mark.qtyReceived <= 0 ? '' : qtyInputText(mark.qtyReceived);
}
