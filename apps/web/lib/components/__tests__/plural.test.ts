import { describe, expect, it } from 'vitest';
import { ALL_NAMESPACES } from '../../i18n/messages';
import { createTranslator, defineMessages, interpolate, type MessageTree } from '../../i18n/translate';

/** The v1 runtime, verbatim — every existing string must render exactly as it did. */
function legacyInterpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

function leaves(tree: MessageTree, prefix = ''): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`),
  );
}

describe('ICU-lite plurals in translate.ts', () => {
  const days = '{count, plural, one {יום אחד} two {יומיים} other {# ימים}}';

  it('Hebrew gets one / two (dual) / other', () => {
    expect(interpolate(days, { count: 1 })).toBe('יום אחד');
    expect(interpolate(days, { count: 2 })).toBe('יומיים');
    expect(interpolate(days, { count: 3 })).toBe('3 ימים');
    expect(interpolate(days, { count: 1250 })).toBe('1,250 ימים');
  });

  it('exact =N wins over the category, and other placeholders still fill', () => {
    const t = '{count, plural, =0 {אין פריטים} one {פריט אחד אצל {supplier}} other {# פריטים אצל {supplier}}}';
    expect(interpolate(t, { count: 0, supplier: 'תנובה' })).toBe('אין פריטים');
    expect(interpolate(t, { count: 1, supplier: 'תנובה' })).toBe('פריט אחד אצל תנובה');
    expect(interpolate(t, { count: 7, supplier: 'תנובה' })).toBe('7 פריטים אצל תנובה');
  });

  it('English uses its own categories (no dual)', () => {
    const t = '{count, plural, one {# item} other {# items}}';
    expect(interpolate(t, { count: 1 }, 'en-GB')).toBe('1 item');
    expect(interpolate(t, { count: 2 }, 'en-GB')).toBe('2 items');
  });

  it('text around the plural and several plurals in one string', () => {
    const t = 'נמצאו {n, plural, one {חריגה אחת} other {# חריגות}} ב-{d, plural, one {יום} two {יומיים} other {# ימים}}.';
    expect(interpolate(t, { n: 1, d: 2 })).toBe('נמצאו חריגה אחת ב-יומיים.');
  });

  it('a missing count or a malformed block is left verbatim (never throws)', () => {
    expect(interpolate(days, {})).toBe(days);
    expect(interpolate(days)).toBe(days);
    expect(interpolate('{count, plural, one {x}}', { count: 1 })).toBe('{count, plural, one {x}}');
    expect(interpolate('{count, plural, one {x', { count: 1 })).toBe('{count, plural, one {x');
  });

  it('the translator resolves plurals in the rendered locale', () => {
    const ns = defineMessages('pluralProbe', { d: days }, { d: '{count, plural, one {# day} other {# days}}' });
    expect(createTranslator('he', ns)('d', { count: 2 })).toBe('יומיים');
    expect(createTranslator('en', ns)('d', { count: 2 })).toBe('2 days');
  });

  it('every existing string in every namespace renders exactly as with the v1 runtime', () => {
    let checked = 0;
    for (const ns of ALL_NAMESPACES) {
      for (const tree of [ns.he, ns.en as MessageTree]) {
        for (const [, text] of leaves(tree)) {
          const vars = Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map((m, i) => [m[1]!, i % 2 ? 7 : 'X']));
          expect(interpolate(text, vars)).toBe(legacyInterpolate(text, vars));
          expect(interpolate(text)).toBe(text);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
