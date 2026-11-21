import { describe, expect, it } from 'vitest';
import { kitEn, kitHe } from '../_copy';

type Tree = { [k: string]: string | Tree };
const leaves = (t: Tree, p = ''): Array<[string, string]> =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[`${p}${k}`, v] as [string, string]] : leaves(v, `${p}${k}.`)));

describe('kit page copy (lab, platform admins only)', () => {
  it('he/en key parity, no empty strings', () => {
    const he = leaves(kitHe as unknown as Tree);
    const en = leaves(kitEn as unknown as Tree);
    expect(en.map(([k]) => k).sort()).toEqual(he.map(([k]) => k).sort());
    for (const [, v] of [...he, ...en]) expect(v.trim()).not.toBe('');
  });

  it('keeps the product rules: no banned terms, no "1.5%", gender-neutral imperatives', () => {
    const text = leaves(kitHe as unknown as Tree).map(([, v]) => v).join('\n');
    for (const banned of ['דרישה', 'תביעה', 'נחסם', 'נחסך', 'הפסד', 'חיסכון', 'חריגה', 'ריכוז', '1.5%', 'יעד']) expect(text).not.toContain(banned);
    // Buttons in the demo are plural imperatives or noun forms (never a masculine singular imperative).
    expect(kitHe.demo.remind).toBe('שלחו תזכורת');
    expect(kitHe.demo.retry).toBe('נסו שוב');
  });

  it('every card has a title and a note', () => {
    expect(Object.keys(kitHe.notes).sort()).toEqual(Object.keys(kitHe.cards).sort());
  });
});
