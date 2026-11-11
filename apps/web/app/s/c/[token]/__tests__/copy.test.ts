import { describe, expect, it } from 'vitest';
import { CLAIM_PORTAL_COPY, claimCopy, fill } from '../copy';

/**
 * H-06ʰ vocabulary guard: the reply link is supplier-facing, so every Hebrew
 * string follows GLOSSARY §1–§2 (owner decisions W1–W2). Substring match on
 * purpose — "חובה" also fails, because it reads as "חוב" to a supplier.
 */
const NEVER_HE = [
  'דריש',
  'דרוש',
  'נדרש',
  'לדרוש',
  'תביע',
  'לתבוע',
  'מחלוקת',
  'חוב',
  'חייב',
  'באיחור',
  'דליפה',
  'ויתרנו',
  'עליכם',
  'לאלתר',
  'יש להעביר',
  'זיכויים פתוחים',
  'בבירור',
  'חריג',
  'גבייה',
  'לגבות',
  'מכתב זיכוי',
];
const NEVER_EN = [/\bclaim/i, /\bdisput/i, /\bowed?\b/i, /\boverdue/i, /\bdemand/i, /\bleak/i, /\bdebt/i];

function strings(o: unknown): string[] {
  if (typeof o === 'string') return [o];
  if (o && typeof o === 'object') return Object.values(o).flatMap(strings);
  return [];
}

describe('claim portal copy (H-06ʰ)', () => {
  it('Hebrew never uses a word from the never-list', () => {
    for (const s of strings(CLAIM_PORTAL_COPY.he)) {
      for (const bad of NEVER_HE) expect(s, `"${bad}" in: ${s}`).not.toContain(bad);
    }
  });

  it('English never uses claim / dispute / owed / overdue / demand / leak / debt', () => {
    for (const s of strings(CLAIM_PORTAL_COPY.en)) {
      for (const bad of NEVER_EN) expect(s, `${bad} in: ${s}`).not.toMatch(bad);
    }
  });

  it('names our letter "מכתב בקשת זיכוי" and their document "חשבונית זיכוי"', () => {
    expect(CLAIM_PORTAL_COPY.he.eyebrow).toBe('מכתב בקשת זיכוי');
    expect(CLAIM_PORTAL_COPY.he.intro).toContain('חשבונית זיכוי');
    expect(CLAIM_PORTAL_COPY.he.check).toBe('נבדוק יחד');
    expect(CLAIM_PORTAL_COPY.he.doneTitle).toContain('תודה');
  });

  it('both locales carry the same keys and every reason', () => {
    expect(Object.keys(CLAIM_PORTAL_COPY.en).sort()).toEqual(Object.keys(CLAIM_PORTAL_COPY.he).sort());
    expect(Object.keys(CLAIM_PORTAL_COPY.en.reasons).sort()).toEqual(Object.keys(CLAIM_PORTAL_COPY.he.reasons).sort());
    expect(claimCopy('fr')).toBe(CLAIM_PORTAL_COPY.he);
  });

  it('fill() substitutes known keys and leaves unknown ones visible', () => {
    expect(fill('{a} · {b}', { a: 'x' })).toBe('x · {b}');
  });
});
