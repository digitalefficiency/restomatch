import { describe, expect, it } from 'vitest';
import { en as authEn } from '../../i18n/messages/auth/en';
import { he as authHe } from '../../i18n/messages/auth/he';
import { auth as ar } from '../../i18n/messages/receiverLangs/overlays/ar/auth';
import { auth as ru } from '../../i18n/messages/receiverLangs/overlays/ru/auth';
import { auth as th } from '../../i18n/messages/receiverLangs/overlays/th/auth';
import { auth as ti } from '../../i18n/messages/receiverLangs/overlays/ti/auth';
import { en as teamEn } from '../../i18n/messages/team/en';
import { he as teamHe } from '../../i18n/messages/team/he';

/**
 * W3-07b: the copy guard measures Hebrew only (walkHebrew). The visible strings
 * this package shortened for it must hold the same cap (1 sentence, at most 12
 * words) in EVERY language that renders them, not just Hebrew (review low 5).
 */
const KEYS = {
  codeLogin: ['resent', 'errors.sendRate', 'errors.wrongCode', 'errors.rate'],
  passkeys: ['intro', 'introWhere', 'notForRole', 'failed'],
} as const;

/**
 * Script-neutral counts: lib/copy/words matches Hebrew + Latin letters only, so
 * Arabic, Cyrillic, Thai and Ethiopic would read as 0 words there. Words =
 * whitespace-separated tokens; sentence ends = . ! ? ; the Ethiopic full stop ።
 * and a spaced dash (the guard's own break rules, plus ።).
 */
const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string) =>
  s
    .split(/[.!?;\u1362]|\s—\s/)
    .map((x) => x.trim())
    .filter(Boolean);

type Tree = Record<string, unknown>;
const at = (tree: Tree, path: string): unknown => path.split('.').reduce<unknown>((t, k) => (t as Tree | undefined)?.[k], tree);

const AUTH: Record<string, Tree> = {
  he: authHe as unknown as Tree,
  en: authEn as unknown as Tree,
  ar: ar as unknown as Tree,
  ru: ru as unknown as Tree,
  th: th as unknown as Tree,
  ti: ti as unknown as Tree,
};

describe('W3-07b visible copy: 1 sentence, at most 12 words, in every language', () => {
  for (const [locale, tree] of Object.entries(AUTH)) {
    for (const [ns, keys] of Object.entries(KEYS)) {
      for (const key of keys) {
        it(`${locale} auth:${ns}.${key}`, () => {
          const text = at(tree, `${ns}.${key}`);
          expect(typeof text, `${locale} ${ns}.${key} exists`).toBe('string');
          expect(countWords(text as string)).toBeLessThanOrEqual(12);
          expect(sentences(text as string)).toHaveLength(1);
        });
      }
    }
  }
  for (const [locale, tree] of Object.entries({ he: teamHe, en: teamEn })) {
    it(`${locale} team:invite.qrAlt`, () => {
      const text = at(tree as unknown as Tree, 'invite.qrAlt') as string;
      expect(countWords(text)).toBeLessThanOrEqual(12);
      expect(sentences(text)).toHaveLength(1);
    });
  }
});
