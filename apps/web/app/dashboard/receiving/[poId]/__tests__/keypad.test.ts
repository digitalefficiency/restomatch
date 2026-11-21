import { describe, expect, it } from 'vitest';
import {
  PAD_KEYS,
  PAD_MAX_DEC,
  PAD_MAX_INT,
  initialPadText,
  isWhole,
  padKeyFromKeyboard,
  padStep,
  padValue,
  sanitizeTyped,
  stepText,
  typeKey,
  type PadKey,
} from '../_keypad';

const type = (keys: PadKey[], start = '', replace = false, whole = false) =>
  keys.reduce<{ t: string; r: boolean }>((s, k) => ({ t: typeKey(s.t, k, s.r, whole), r: false }), { t: start, r: replace }).t;

describe('the dock number pad (DS3-05) — one typing rule in every language', () => {
  it('is a 3 × 4 grid of digits, a point, 0 and delete', () => {
    expect(PAD_KEYS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']);
  });

  it('types digits and one decimal point', () => {
    expect(type(['2', '4', '.', '5'])).toBe('24.5');
    expect(type(['2', '.', '.', '5'])).toBe('2.5');
    expect(type(['.', '5'])).toBe('0.5');
  });

  it('an item counted in whole units takes no decimal point (the key is off; a stray one changes nothing)', () => {
    expect(type(['2', '.', '5'], '', false, true)).toBe('25');
    expect(type(['.'], '24', true, true)).toBe('24');
    expect(isWhole('יח׳')).toBe(true);
    expect(isWhole('ארגז')).toBe(true);
    expect(isWhole('ארגז', 3)).toBe(true);
    expect(isWhole('ק״ג')).toBe(false);
  });

  it('keeps the point wherever today accepts a decimal: an unknown unit, half a case on the order', () => {
    expect(isWhole('KG', 2.5)).toBe(false); // Latin, not in the unit table
    expect(isWhole('lb')).toBe(false);
    expect(isWhole('צנוברים')).toBe(false); // a Hebrew word the table does not know
    expect(isWhole(null)).toBe(false);
    expect(isWhole('ארגז', 0.5)).toBe(false); // the order itself says half a case
    expect(isWhole('Case', 4)).toBe(true); // an English label the table names
  });

  it('a leading 0 is replaced, not kept as 07', () => {
    expect(type(['0', '7'])).toBe('7');
    expect(type(['0', '.', '7'])).toBe('0.7');
  });

  it('keeps at most three decimals and seven digits before the point', () => {
    expect(type(['1', '.', '1', '2', '3', '4'])).toBe('1.123');
    expect(PAD_MAX_DEC).toBe(3);
    const long = Array.from({ length: PAD_MAX_INT + 3 }, () => '9' as PadKey);
    expect(type(long)).toBe('9'.repeat(PAD_MAX_INT));
    // Grams run to five digits: never refused.
    expect(type(['1', '2', '5', '0', '0'])).toBe('12500');
  });

  it('delete removes the last character', () => {
    expect(type(['2', '4', 'del'])).toBe('2');
    expect(type(['del'])).toBe('');
  });

  it('a pre-filled value reads as selected: the first key replaces it, delete clears it', () => {
    expect(type(['8'], '28.5', true)).toBe('8');
    expect(type(['8', '.', '5'], '28.5', true)).toBe('8.5');
    expect(type(['del'], '28.5', true)).toBe('');
    expect(type(['.'], '28.5', true)).toBe('0.');
  });

  it('a hardware keyboard types the same keys, including Arabic-Indic digits and a comma', () => {
    expect(padKeyFromKeyboard('7')).toBe('7');
    expect(padKeyFromKeyboard('٣')).toBe('3');
    expect(padKeyFromKeyboard('۵')).toBe('5');
    expect(padKeyFromKeyboard(',')).toBe('.');
    expect(padKeyFromKeyboard('.')).toBe('.');
    expect(padKeyFromKeyboard('٫')).toBe('.');
    expect(padKeyFromKeyboard('Backspace')).toBe('del');
    expect(padKeyFromKeyboard('a')).toBeNull();
    expect(padKeyFromKeyboard('Enter')).toBeNull();
  });

  it('reads the typed text with the wizard parser: empty and a lone point are no quantity', () => {
    expect(padValue('')).toBeNull();
    expect(padValue('.')).toBeNull();
    expect(padValue('0.')).toBe(0);
    expect(padValue('24.5')).toBe(24.5);
    expect(padValue('0')).toBe(0);
  });

  it('the − / + is a small correction: one unit, half a kilo or litre, none for grams', () => {
    expect(padStep('יח׳')).toBe(1);
    expect(padStep('צרור')).toBe(1);
    expect(padStep('ק״ג')).toBe(0.5);
    expect(padStep('ליטר')).toBe(0.5);
    expect(padStep('גרם')).toBeNull();
    expect(padStep('מ״ל')).toBeNull();
  });

  it('steps and never goes below zero', () => {
    expect(stepText('3', 1)).toBe('4');
    expect(stepText('0', -1)).toBe('0');
    expect(stepText('', 1)).toBe('1');
    expect(stepText('2.5', -1)).toBe('1.5');
    expect(stepText('24', 0.5)).toBe('24.5');
    expect(stepText('0.25', -0.5)).toBe('0');
  });

  it('opens on the count, else on the ordered quantity — or empty when the restaurant counts blind', () => {
    const untouched = { touched: false, qtyReceived: 28.5 };
    expect(initialPadText(untouched, false)).toBe('28.5');
    expect(initialPadText(untouched, true)).toBe('');
    expect(initialPadText({ touched: true, qtyReceived: 24 }, true)).toBe('24');
    expect(initialPadText({ touched: true, qtyReceived: 0, rejectReason: 'missing' }, false)).toBe('0');
    // Billed but not ordered: nothing is assumed to have arrived.
    expect(initialPadText({ touched: false, qtyReceived: 0 }, false)).toBe('');
  });

  it('keeps what a hardware keyboard or a fill types to the same rule', () => {
    expect(sanitizeTyped('24.5')).toBe('24.5');
    expect(sanitizeTyped('11,640')).toBe('11.640');
    expect(sanitizeTyped('2,125')).toBe('2.125');
    expect(sanitizeTyped('٢٤٫٥')).toBe('24.5');
    expect(sanitizeTyped('007')).toBe('7');
    expect(sanitizeTyped('0')).toBe('0');
    expect(sanitizeTyped('.5')).toBe('0.5');
    expect(sanitizeTyped('')).toBe('');
    expect(sanitizeTyped('1.2345')).toBeNull();
    expect(sanitizeTyped('12a')).toBeNull();
    expect(sanitizeTyped('-3')).toBeNull();
    expect(sanitizeTyped('1.2.3')).toBeNull();
    expect(sanitizeTyped('9'.repeat(PAD_MAX_INT + 1))).toBeNull();
    // Whole units: digits only.
    expect(sanitizeTyped('12', true)).toBe('12');
    expect(sanitizeTyped('2.5', true)).toBeNull();
  });
});
