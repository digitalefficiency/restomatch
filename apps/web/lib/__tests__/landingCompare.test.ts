import { describe, expect, it } from 'vitest';
import { landingFlag } from '../landingFlags';
import { he } from '../i18n/messages/growth/he';
import { en } from '../i18n/messages/growth/en';
import { COMPARE_ROWS } from '../growth/LandingCompare';

/**
 * Landing "ordering system vs RestoMatch" (S15, flag landingCompare). The copy
 * rules from the critic are enforced here so a later edit can't slip them in.
 */
const texts = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : Object.values(o as Record<string, unknown>).flatMap(texts);

describe('landingCompare', () => {
  it('is OFF unless LANDING_FLAGS lists it, and the kill-switch wins', () => {
    expect(landingFlag('landingCompare', {})).toBe(false);
    expect(landingFlag('landingCompare', { LANDING_FLAGS: 'landingOrdersStory' })).toBe(false);
    expect(landingFlag('landingCompare', { LANDING_FLAGS: 'landingCompare' })).toBe(true);
    expect(landingFlag('landingCompare', { LANDING_FLAGS: 'landingCompare', FEATURES_OFF: 'landingCompare' })).toBe(false);
  });

  it('has exactly the 5 agreed rows, in he and en', () => {
    expect(COMPARE_ROWS).toEqual(['number', 'dock', 'invoice', 'payment', 'supplier']);
    for (const m of [he, en]) expect(Object.keys(m.compare.rows)).toEqual([...COMPARE_ROWS]);
  });

  it.each([
    ['he', he],
    ['en', en],
  ])('%s copy: no competitor names, no VAT claim, no payment-rail promise, no numbers but the 12 checks', (_l, m) => {
    const all = texts(m.compare).join('\n');
    expect(all).not.toMatch(/marketman|zestt?|zester|tabit|restigo|מרקטמן|זסט|טאביט/i);
    expect(all).not.toMatch(/VAT|מע״מ|מע"מ/);
    expect(all).not.toMatch(/won.t (get )?pa(y|id)|לא ישולם|לא ישלמו/i);
    expect(all).not.toMatch(/PDF/);
    expect(all.match(/\d+/g) ?? []).toEqual(['12']);
  });
});
