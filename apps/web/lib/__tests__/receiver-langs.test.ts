import { describe, expect, it } from 'vitest';
import {
  appLocaleFromCookieHeader,
  baseLocaleOf,
  dirOf,
  isAppLocale,
  RECEIVER_LOCALES,
  resolveAppLocale,
  resolveLocale,
} from '../i18n/config';
import {
  ALL_NAMESPACES,
  auth,
  common,
  components,
  ingest,
  nav,
  overview,
  receiverLangs,
  receiving,
  receivingDelivery,
  scans,
} from '../i18n/messages';
import { createTranslator, defineMessages, lookup, withReceiverLocales, type MessageTree } from '../i18n/translate';

/**
 * Receiver languages (S14, flag `receiverLanguages`). The receiver-facing
 * namespaces must be COMPLETE in ar/ru/th/ti (typed by CompleteOverlays and
 * re-checked here at runtime). A gap in an overlaid namespace falls back to
 * Hebrew; a namespace with no overlays at all falls back to English.
 */
function leafPaths(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leafPaths(v, `${prefix}${k}.`),
  );
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const HEBREW = /[֐-׿]/;

/** Script each locale must be written in (at least one char of it per non-trivial string). */
const SCRIPT: Record<(typeof RECEIVER_LOCALES)[number], RegExp> = {
  ar: /[؀-ۿ]/,
  ru: /[Ѐ-ӿ]/,
  th: /[฀-๿]/,
  ti: /[ሀ-᎟ⶀ-⷟]/,
};

/** Receiver namespaces and the subtrees (or single leaves — dotted roots work) that must be complete. */
const RECEIVER: Array<{ ns: { name: string; he: MessageTree; extra?: unknown }; roots?: string[] }> = [
  { ns: receiving as never },
  // W1-06 Delivery Check: capture, count, save state, leave + sign-out guards.
  { ns: receivingDelivery as never },
  { ns: scans as never },
  { ns: nav as never },
  { ns: components as never },
  { ns: receiverLangs as never },
  { ns: auth as never, roots: ['login', 'checkEmail', 'twoFactor', 'signin'] },
  // The receiver's home (W1-05): the deliveries board and its h1/subtitle.
  { ns: overview as never, roots: ['board', 'homeTitle.receiver', 'homeSubtitle.receiver'] },
  // Shell resilience (W1-04): offline chip, re-auth sheet, 403/404/error pages inside the shell.
  // …plus the generic actions/states and screen names every receiver screen uses.
  {
    ns: common as never,
    roots: [
      'shell.offline',
      'shell.session',
      'shell.forbidden',
      'shell.notFound',
      'shell.error',
      'shell.screens',
      'shell.listSep',
      'shell.listLast',
      'actions',
      'states',
    ],
  },
  // The receiver PWA (S13) speaks to the same receivers: offline banner, queue, sync.
  { ns: ingest as never, roots: ['pwa'] },
];

describe('receiver locale config', () => {
  it('knows the six app locales; a receiver locale is English for formatting', () => {
    expect(RECEIVER_LOCALES).toEqual(['ar', 'ru', 'th', 'ti']);
    for (const l of ['he', 'en', 'ar', 'ru', 'th', 'ti']) expect(isAppLocale(l)).toBe(true);
    expect(isAppLocale('fr')).toBe(false);
    expect(resolveLocale('ar')).toBe('en');
    expect(resolveLocale('fr')).toBe('he');
    expect(resolveAppLocale('th')).toBe('th');
    expect(baseLocaleOf('ti')).toBe('en');
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('ru')).toBe('ltr');
    expect(dirOf('ti')).toBe('ltr');
    expect(appLocaleFromCookieHeader('a=1; rm_locale=ru')).toBe('ru');
    expect(appLocaleFromCookieHeader('rm_locale=xx')).toBe('he');
  });
});

describe('receiver namespaces are complete in ar/ru/th/ti', () => {
  for (const { ns, roots } of RECEIVER) {
    const heKeys = leafPaths(ns.he).filter((k) => !roots || roots.some((r) => k === r || k.startsWith(`${r}.`)));
    for (const locale of RECEIVER_LOCALES) {
      it(`${ns.name} (${locale}): every key, same placeholders, no Hebrew, native script`, () => {
        const tree = (ns.extra as Record<string, MessageTree> | undefined)?.[locale];
        expect(tree, `${ns.name} has no ${locale} overlay`).toBeDefined();
        const got = leafPaths(tree!).sort();
        expect(got).toEqual([...heKeys].sort());
        let scripted = 0;
        for (const key of heKeys) {
          const v = lookup(tree, key)!;
          const he = lookup(ns.he, key)!;
          expect(v.trim(), `${ns.name}.${key} (${locale}) empty`).not.toBe('');
          expect(placeholders(v), `${ns.name}.${key} (${locale}) placeholders`).toEqual(placeholders(he));
          expect(HEBREW.test(v), `${ns.name}.${key} (${locale}) has Hebrew`).toBe(false);
          if (SCRIPT[locale].test(v)) scripted += 1;
        }
        // Brand names / emails / keys may stay Latin, but the bulk must be translated.
        expect(scripted / heKeys.length).toBeGreaterThan(0.85);
      });
    }
  }
});

describe('fallback chain: overlaid namespace → overlay → Hebrew; no overlays → English → Hebrew', () => {
  it('a receiver namespace renders in the receiver language', () => {
    const t = createTranslator('ar', nav);
    expect(t('links.receiving')).toMatch(SCRIPT.ar);
    expect(t.locale).toBe('en');
    expect(t.appLocale).toBe('ar');
  });

  it('a non-receiver namespace falls back to English, never Hebrew', () => {
    const others = ALL_NAMESPACES.filter((n) => !('extra' in n) || !n.extra);
    expect(others.length).toBeGreaterThan(5);
    for (const ns of others) {
      const key = leafPaths(ns.he as MessageTree)[0];
      if (!key) continue;
      for (const locale of RECEIVER_LOCALES) {
        const t = createTranslator(locale, ns as never) as unknown as (k: string) => string;
        expect(t(key)).toBe(lookup(ns.en as MessageTree, key));
      }
    }
  });

  it('a key outside an overlaid namespace\'s slice (auth.reset) falls back to Hebrew, never English', () => {
    const t = createTranslator('th', auth);
    expect(t('reset.requestTitle')).toBe(lookup(auth.he as MessageTree, 'reset.requestTitle'));
    expect(t('reset.requestTitle')).not.toBe(lookup(auth.en as MessageTree, 'reset.requestTitle'));
    expect(t('login.title')).toMatch(SCRIPT.th);
  });

  it('overlaid namespace + missing key → Hebrew; non-overlaid namespace → English', () => {
    const he = { a: 'שלום', b: 'להתראות {name}' };
    const en = { a: 'Hello', b: 'Goodbye {name}' };
    const bare = defineMessages('fallbackBare', he, en);
    const overlaid = withReceiverLocales(bare, { ru: { a: 'Привет' } });
    for (const locale of RECEIVER_LOCALES) {
      const tb = createTranslator(locale, bare);
      expect(tb('a')).toBe('Hello');
      expect(tb('b', { name: 'X' })).toBe('Goodbye X');
      const to = createTranslator(locale, overlaid);
      expect(to('b', { name: 'X' })).toBe('להתראות X');
      expect(to('a')).toBe(locale === 'ru' ? 'Привет' : 'שלום');
    }
    // he/en are untouched by overlays.
    expect(createTranslator('en', overlaid)('a')).toBe('Hello');
    expect(createTranslator('he', overlaid)('a')).toBe('שלום');
  });

  it('the W1-06 receiver flow renders in the receiver language (delivery, board, shell, sign-in)', () => {
    expect(createTranslator('ti', receivingDelivery)('delivery.count.sessionExpired')).toMatch(SCRIPT.ti);
    expect(createTranslator('ru', overview)('board.cta.start')).toMatch(SCRIPT.ru);
    expect(createTranslator('ru', overview)('homeTitle.receiver')).toMatch(SCRIPT.ru);
    expect(createTranslator('ar', common)('shell.offline.chip')).toMatch(SCRIPT.ar);
    expect(createTranslator('th', auth)('signin.showPassword')).toMatch(SCRIPT.th);
  });
});

describe('first paint in the member’s language (no Hebrew → English flash)', () => {
  it('the device cookie wins; with none, a signed-in member’s saved language renders from the first paint', async () => {
    const { pickAppLocale } = await import('../i18n/config');
    expect(pickAppLocale('he', 'en')).toBe('he'); // the device chose — the switcher always wins
    expect(pickAppLocale(undefined, 'en')).toBe('en'); // before: Hebrew first, English after a refresh
    expect(pickAppLocale(undefined, 'th')).toBe('th');
    expect(pickAppLocale('xx', 'en')).toBe('en'); // a junk cookie is no choice
    expect(pickAppLocale(undefined, null)).toBe('he');
    expect(pickAppLocale(undefined, 'fr')).toBe('he');
  });
});
