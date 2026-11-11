import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  defineMessages,
  FSI,
  interpolate,
  needsIsolation,
  PDI,
  stripIsolates,
} from '../translate';

const iso = (s: string) => `${FSI}${s}${PDI}`;

describe('interpolate: direction-aware bidi isolation (copy-rtl-13)', () => {
  it.each([
    // [value, sentence rtl?, isolated?]
    ['Coca-Cola Ltd.', true, true], // Latin + neutrals in a Hebrew sentence
    ['Tnuva 24', true, true], // Latin + digits
    ['"Acme"', true, true], // quotes around Latin
    ['תנובה בע״מ', false, true], // Hebrew + space in an English sentence
    ['תנובה', true, false], // same script
    ['Tnuva', true, false], // a single other-script word cannot reorder
    ['X', true, false],
    ['1,234', true, false], // pure numerals
    ['₪ 1,234.50', true, false], // formatted money (no letters)
    ['12%', true, false],
    ['Coca-Cola Ltd.', false, false], // same direction as an English sentence
  ])('%s in rtl=%s → isolated=%s', (value, rtl, expected) => {
    expect(needsIsolation(value, rtl)).toBe(expected);
  });

  it('Lab I: a Latin supplier keeps its trailing period inside the isolate', () => {
    const out = interpolate('בהזמנה מ-{supplier} הפריט לא הגיע.', { supplier: 'Coca-Cola Ltd.' });
    expect(out).toBe(`בהזמנה מ-${iso('Coca-Cola Ltd.')} הפריט לא הגיע.`);
    expect(out).toContain('Coca-Cola Ltd.'); // contiguous, period attached
    expect(stripIsolates(out)).toBe('בהזמנה מ-Coca-Cola Ltd. הפריט לא הגיע.');
  });

  it('a Hebrew name in an English sentence is isolated', () => {
    expect(interpolate('Order from {s}', { s: 'ירקות השרון' }, 'en-GB')).toBe(`Order from ${iso('ירקות השרון')}`);
  });

  it('pure numerals and same-script values pass through byte-identical', () => {
    expect(interpolate('{n} פריטים אצל {s}', { n: 1234, s: 'תנובה' })).toBe('1234 פריטים אצל תנובה');
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });

  it('the raw opt-out splices the value verbatim', () => {
    const out = interpolate('קובץ: {file}', { file: 'invoice 12.pdf' }, 'he-IL', { raw: ['file'] });
    expect(out).toBe('קובץ: invoice 12.pdf');
  });

  it('plurals are unchanged and isolation applies to the other vars', () => {
    const tpl = '{count, plural, one {פריט אחד} two {שני פריטים} other {# פריטים}} מ-{s}';
    expect(interpolate(tpl, { count: 2, s: 'Coca-Cola Ltd.' })).toBe(`שני פריטים מ-${iso('Coca-Cola Ltd.')}`);
    expect(interpolate(tpl, { count: 3, s: 'תנובה' })).toBe('3 פריטים מ-תנובה');
  });

  it('createTranslator isolates by the rendered locale and honours raw', () => {
    const ns = defineMessages('bidiProbe', { m: 'מ-{s}' }, { m: 'from {s}' });
    expect(createTranslator('he', ns)('m', { s: 'Coca-Cola Ltd.' })).toBe(`מ-${iso('Coca-Cola Ltd.')}`);
    expect(createTranslator('en', ns)('m', { s: 'Coca-Cola Ltd.' })).toBe('from Coca-Cola Ltd.');
    expect(createTranslator('he', ns)('m', { s: 'Coca-Cola Ltd.' }, { raw: ['s'] })).toBe('מ-Coca-Cola Ltd.');
  });

  it('an already-isolated value is not double-wrapped; stripIsolates removes every isolate mark', () => {
    expect(interpolate('מ-{s}', { s: iso('A B') })).toBe(`מ-${iso('A B')}`);
    expect(stripIsolates('⁦a⁧b⁨c⁩')).toBe('abc');
  });
});
