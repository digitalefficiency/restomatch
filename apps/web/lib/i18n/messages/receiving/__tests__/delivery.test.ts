import { describe, expect, it } from 'vitest';
import { lookup, type MessageTree } from '../../../translate';
import { receivingDelivery } from '../delivery';

const leafPaths = (tree: MessageTree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leafPaths(v, `${prefix}${k}.`)));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** 'receivingDelivery' is also in ALL_NAMESPACES (i18n.test.ts); its receiver overlays are checked in receiver-langs.test.ts. */
describe('receivingDelivery catalog parity (he ⇄ en)', () => {
  const he = receivingDelivery.he as MessageTree;
  const en = receivingDelivery.en as MessageTree;

  it('every key in both, same placeholders, no Hebrew in English', () => {
    expect(leafPaths(en).sort()).toEqual(leafPaths(he).sort());
    for (const key of leafPaths(he)) {
      expect(placeholders(lookup(en, key)!), key).toEqual(placeholders(lookup(he, key)!));
      expect(/[֐-׿]/.test(lookup(en, key)!), `${key} (en) has Hebrew`).toBe(false);
    }
  });

  it('house copy: no jargon, no masculine-singular "צלם / העלה" CTA', () => {
    const all = leafPaths(he).map((k) => lookup(he, k)!).join('\n');
    for (const bad of ['לקבע', 'המוקפא', 'ביטחון OCR', 'צלם /', 'העלה קובץ', 'וודא']) expect(all).not.toContain(bad);
  });
});
