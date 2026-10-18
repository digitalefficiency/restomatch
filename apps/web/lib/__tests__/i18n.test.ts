import { describe, expect, it } from 'vitest';
import {
  dirOf,
  intlLocaleOf,
  isLocale,
  localeFromCookieHeader,
  resolveLocale,
  withLocaleCookie,
} from '../i18n/config';
import { formatDate, formatNumber, formatRelative } from '../i18n/format';
import { ALL_NAMESPACES } from '../i18n/messages';
import { createTranslator, defineMessages, interpolate, lookup, type MessageTree } from '../i18n/translate';
import { formatIls } from '../money';

/** Every dotted leaf path in a message tree. */
function leafPaths(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafPaths(v, `${prefix}${k}.`),
  );
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

describe('i18n config', () => {
  it('resolves locales with a Hebrew default', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(resolveLocale(undefined)).toBe('he');
    expect(resolveLocale('en')).toBe('en');
    expect(dirOf('he')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(intlLocaleOf('he')).toBe('he-IL');
  });

  it('reads the locale cookie out of a raw Cookie header', () => {
    expect(localeFromCookieHeader('a=1; rm_locale=en; b=2')).toBe('en');
    expect(localeFromCookieHeader('rm_locale=xx')).toBe('he');
    expect(localeFromCookieHeader(null)).toBe('he');
  });

  it('rewrites the Cookie header for a ?lang= override', () => {
    expect(withLocaleCookie('a=1; rm_locale=he', 'en')).toBe('a=1; rm_locale=en');
    expect(withLocaleCookie(null, 'en')).toBe('rm_locale=en');
    expect(localeFromCookieHeader(withLocaleCookie('x=y', 'en'))).toBe('en');
  });
});

describe('translator runtime', () => {
  const ns = defineMessages(
    'test',
    { greet: 'שלום {name}', nested: { deep: 'עמוק' }, onlyHe: 'רק עברית' },
    { greet: 'Hello {name}', nested: { deep: 'Deep' }, onlyHe: '' },
  );

  it('looks up dotted keys and interpolates', () => {
    expect(createTranslator('en', ns)('greet', { name: 'Rom' })).toBe('Hello Rom');
    expect(createTranslator('he', ns)('nested.deep')).toBe('עמוק');
    expect(lookup(ns.he, 'nested')).toBeUndefined();
  });

  it('keeps unknown placeholders and never throws on a missing key', () => {
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
    // @ts-expect-error — deliberately unknown key
    expect(createTranslator('en', ns)('missing.key')).toBe('missing.key');
  });
});

describe('message catalog parity (he ⇄ en)', () => {
  for (const ns of ALL_NAMESPACES) {
    it(`${ns.name}: English has exactly the Hebrew keys, all non-empty, same placeholders`, () => {
      const heKeys = leafPaths(ns.he as MessageTree).sort();
      const enKeys = leafPaths(ns.en as MessageTree).sort();
      expect(enKeys).toEqual(heKeys);
      for (const key of heKeys) {
        const heStr = lookup(ns.he as MessageTree, key)!;
        const enStr = lookup(ns.en as MessageTree, key)!;
        expect(heStr.trim(), `${ns.name}.${key} (he) is empty`).not.toBe('');
        expect(enStr.trim(), `${ns.name}.${key} (en) is empty`).not.toBe('');
        expect(placeholders(enStr), `${ns.name}.${key} placeholders differ`).toEqual(placeholders(heStr));
        // An English string should not still be Hebrew (copy-paste slip).
        if (!['language.he'].includes(key)) {
          expect(/[֐-׿]/.test(enStr), `${ns.name}.${key} (en) contains Hebrew`).toBe(false);
        }
      }
    });
  }

  it('namespace names are unique', () => {
    const names = ALL_NAMESPACES.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('locale-aware formatting', () => {
  it('formats ₪ per locale; Hebrew output is unchanged', () => {
    expect(formatIls(1234)).toBe(new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(1234));
    expect(formatIls(1234, { locale: 'he' })).toBe(formatIls(1234));
    expect(formatIls(1234.5, { locale: 'en', maximumFractionDigits: 2 })).toBe('₪1,234.50');
  });

  it('formats dates in Israel time', () => {
    // 2026-03-01T23:30Z is already March 2nd in Jerusalem.
    expect(formatDate('2026-03-01T23:30:00Z', 'en', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('02/03/2026');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
    expect(formatRelative(new Date('2026-01-01T00:00:00Z'), 'en', new Date('2026-01-04T00:00:00Z'))).toBe('3 days ago');
  });
});
