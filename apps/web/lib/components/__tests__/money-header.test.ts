// D8 (owner decision 7.11): ₪ once in the column header, bookkeeper compact
// tables only. The figure is the frozen formatIls() output minus the glyph.
import { describe, expect, it } from 'vitest';
import { moneyFigureText, moneyText, splitGlyph } from '../money/format';

const strip = (s: string) => s.replace(/[‎‏]/g, '');

describe('moneyFigureText', () => {
  it.each([
    [1267.5, 'line', 'he', '1,267.50'],
    [1267.5, 'line', 'en', '1,267.50'],
    [760, 'inline', 'he', '760'],
    [12.3456, 'unit', 'he', '12.3456'],
    [0, 'line', 'en', '0.00'],
  ] as const)('%s (%s, %s) → %s', (value, context, locale, expected) => {
    const out = moneyFigureText(value, context, locale);
    expect(out).not.toContain('₪');
    expect(strip(out)).toBe(expected);
  });

  it('keeps exactly the digits, grouping and precision of the inline figure', () => {
    for (const locale of ['he', 'en'] as const) {
      for (const [v, ctx] of [[1759.54, 'line'], [42263, 'tile'], [3.2, 'unit'], [-84.96, 'line']] as const) {
        const inline = moneyText(v, ctx, locale);
        const figure = moneyFigureText(v, ctx, locale);
        const inlineDigits = splitGlyph(inline).filter((p) => !p.glyph).map((p) => p.text).join('');
        expect(strip(inlineDigits).trim().replace(/ /g, '')).toBe(strip(figure));
      }
    }
  });

  it('a negative Hebrew figure keeps its leading bidi marks, so the minus stays before the digits', () => {
    const inline = moneyText(-1123, 'line', 'he');
    const figure = moneyFigureText(-1123, 'line', 'he');
    const lead = inline.slice(0, inline.search(/[-−]/));
    expect(lead).toMatch(/[\u200e\u200f]/); // Intl's he output leads with bidi marks
    expect(figure.startsWith(lead)).toBe(true);
    expect(strip(figure)).toMatch(/^[-−]1,123\.00$/);
  });

  it('leaves no trailing space or mark where the glyph was', () => {
    expect(moneyFigureText(1267.5, 'line', 'he')).not.toMatch(/[\s ‎‏]$/);
  });

  it('honours an explicit decimals override like moneyText', () => {
    expect(strip(moneyFigureText(760, 'inline', 'he', 2))).toBe('760.00');
  });
});
