import { describe, expect, it } from 'vitest';
import {
  AUTO_LINK_MIN,
  REVIEW_FLOOR,
  aliasProvenance,
  decideLink,
  isExactKey,
  provenanceConfidence,
  rankSuggestions,
  type LinkCandidate,
  type LinkMatchedBy,
  type LinkProvenance,
  type UnitPackFit,
} from '../linkPolicy';

const cand = (
  confidence: number,
  matchedBy: LinkMatchedBy = 'fuzzy',
  provenance?: LinkProvenance,
  productId = 'p-top',
): LinkCandidate => ({
  productId,
  canonicalName: productId,
  confidence,
  matchedBy,
  ...(provenance ? { provenance } : {}),
});

describe('G-08 decideLink — the decision table', () => {
  it('pins the thresholds', () => {
    expect(AUTO_LINK_MIN).toBe(0.95);
    expect(REVIEW_FLOOR).toBe(0.6);
  });

  it('no candidate → new', () => {
    expect(decideLink([], { unitPack: 'match' })).toEqual({
      decision: 'new',
      productId: null,
      reasons: [],
      suggestions: [],
    });
  });

  const CONFIDENCES = [0.59, 0.6, 0.94, 0.95, 0.999, 1] as const;
  const UNIT_PACK: UnitPackFit[] = ['match', 'mismatch', 'unknown'];
  const SHAPES: Array<{ matchedBy: LinkMatchedBy; provenance?: LinkProvenance; exact: boolean }> = [
    { matchedBy: 'sku', exact: true },
    { matchedBy: 'barcode', exact: true },
    { matchedBy: 'sku', provenance: 'human', exact: true },
    { matchedBy: 'sku', provenance: 'guess', exact: false },
    { matchedBy: 'sku', provenance: 'legacy', exact: false },
    { matchedBy: 'alias', provenance: 'human', exact: true },
    { matchedBy: 'alias', provenance: 'exactKey', exact: true },
    { matchedBy: 'alias', provenance: 'newProduct', exact: true },
    { matchedBy: 'alias', provenance: 'guess', exact: false },
    { matchedBy: 'alias', provenance: 'legacy', exact: false },
    { matchedBy: 'alias', exact: false },
    { matchedBy: 'embedding', exact: false },
    { matchedBy: 'fuzzy', exact: false },
  ];

  for (const shape of SHAPES) {
    for (const conf of CONFIDENCES) {
      for (const unitPack of UNIT_PACK) {
        const label = `${shape.matchedBy}/${shape.provenance ?? '-'} @${conf} unit=${unitPack}`;
        it(label, () => {
          const c = cand(conf, shape.matchedBy, shape.provenance);
          expect(isExactKey(c)).toBe(shape.exact);
          const d = decideLink([c], { unitPack });
          let expected: 'auto' | 'review' | 'new';
          if (conf < REVIEW_FLOOR) expected = 'new';
          else if (unitPack === 'mismatch') expected = 'review';
          else if (shape.exact) expected = 'auto';
          else if (conf >= AUTO_LINK_MIN && unitPack === 'match') expected = 'auto';
          else expected = 'review';
          expect(d.decision).toBe(expected);
          expect(d.productId).toBe(expected === 'auto' ? 'p-top' : null);
          if (expected !== 'review') expect(d.reasons).toEqual([]);
          if (expected === 'review') {
            expect(d.reasons.length).toBeGreaterThan(0);
            if (!shape.exact && conf < AUTO_LINK_MIN) expect(d.reasons).toContain('MEDIUM_CONFIDENCE');
            if (unitPack === 'mismatch') expect(d.reasons).toContain('UNIT_MISMATCH');
            if (unitPack === 'unknown' && conf >= AUTO_LINK_MIN) expect(d.reasons).toEqual(['UNKNOWN_UNIT']);
          }
        });
      }
    }
  }

  it('a pack mismatch reports PACK_MISMATCH', () => {
    const d = decideLink([cand(0.97)], { unitPack: 'mismatch', mismatch: ['PACK_MISMATCH'] });
    expect(d).toMatchObject({ decision: 'review', productId: null, reasons: ['PACK_MISMATCH'] });
  });

  it('medium confidence + unit mismatch reports both, in order', () => {
    const d = decideLink([cand(0.9)], { unitPack: 'mismatch', mismatch: ['UNIT_MISMATCH', 'PACK_MISMATCH'] });
    expect(d.reasons).toEqual(['MEDIUM_CONFIDENCE', 'UNIT_MISMATCH', 'PACK_MISMATCH']);
  });

  it('golden: פלפל אדום חריף vs פלפל אדום at 0.667 → review, never linked', () => {
    const d = decideLink(
      [{ productId: 'p-pepper', canonicalName: 'פלפל אדום', confidence: 0.667, matchedBy: 'fuzzy' }],
      { unitPack: 'match' },
    );
    expect(d.decision).toBe('review');
    expect(d.productId).toBeNull();
    expect(d.reasons).toEqual(['MEDIUM_CONFIDENCE']);
    expect(d.suggestions.map((s) => s.canonicalName)).toEqual(['פלפל אדום']);
  });

  it('a unit mismatch at ≥ 0.9 → review', () => {
    expect(decideLink([cand(0.97, 'embedding')], { unitPack: 'mismatch' }).decision).toBe('review');
    expect(decideLink([cand(0.9, 'embedding')], { unitPack: 'mismatch' }).decision).toBe('review');
  });

  it('decides on the best candidate regardless of input order', () => {
    const d = decideLink([cand(0.7, 'fuzzy', undefined, 'a'), cand(0.97, 'embedding', undefined, 'b')], {
      unitPack: 'match',
    });
    expect(d).toMatchObject({ decision: 'auto', productId: 'b' });
  });
});

describe('G-08 suggestions — order and length', () => {
  it('best first, at most 3, one per product, stable on ties', () => {
    const s = rankSuggestions([
      cand(0.7, 'fuzzy', undefined, 'a'),
      cand(0.9, 'embedding', undefined, 'b'),
      cand(0.8, 'fuzzy', undefined, 'c'),
      cand(0.85, 'fuzzy', undefined, 'b'),
      cand(0.8, 'fuzzy', undefined, 'd'),
      cand(0.65, 'fuzzy', undefined, 'e'),
    ]);
    expect(s.map((x) => x.productId)).toEqual(['b', 'c', 'd']);
    expect(s[0]!.confidence).toBe(0.9);
  });

  it('review carries 1–3 suggestions', () => {
    const d = decideLink(
      [cand(0.7, 'fuzzy', undefined, 'a'), cand(0.66, 'fuzzy', undefined, 'b'), cand(0.62, 'fuzzy', undefined, 'c'), cand(0.61, 'fuzzy', undefined, 'z')],
      { unitPack: 'match' },
    );
    expect(d.decision).toBe('review');
    expect(d.suggestions).toHaveLength(3);
  });
});

describe('G-08 aliasProvenance — interim encoding and the G-03 source column', () => {
  it.each([
    ['1.000', 'human'],
    [1, 'human'],
    ['0.999', 'exactKey'],
    ['0.998', 'legacy'],
    ['0.950', 'legacy'],
    ['0.901', 'legacy'],
    ['0.900', 'guess'],
    ['0.667', 'guess'],
    [null, 'legacy'],
    ['garbage', 'legacy'],
  ] as const)('confidence %s → %s', (confidence, expected) => {
    expect(aliasProvenance({ confidence })).toBe(expected);
  });

  it.each([
    ['human', 'human'],
    ['exact_key', 'exactKey'],
    ['new_product', 'newProduct'],
    ['import_guess', 'guess'],
    ['legacy', 'legacy'],
  ] as const)('source %s → %s (wins over the confidence)', (source, expected) => {
    expect(aliasProvenance({ confidence: '1.000', source })).toBe(expected);
  });

  it('writes the interim encoding: human 1.000, machine 0.999', () => {
    expect(provenanceConfidence('human')).toBe('1.000');
    expect(provenanceConfidence('exactKey')).toBe('0.999');
    expect(provenanceConfidence('newProduct')).toBe('0.999');
    expect(aliasProvenance({ confidence: provenanceConfidence('newProduct') })).toBe('exactKey');
  });
});
