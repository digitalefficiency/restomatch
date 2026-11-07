import { describe, expect, it } from 'vitest';
import { buildLinkQueue, linkKey, summarizeLinkQueue, type LinkCandidate } from '../catalog/linkQueue';

const c = (o: Partial<LinkCandidate>): LinkCandidate => ({
  source: 'no_sku_line',
  supplierId: 's1',
  supplierSku: null,
  nameRaw: 'x',
  unmappedAgorot: 0,
  lineCount: 1,
  lastSeenAt: '2026-10-20T08:00:00.000Z',
  ...o,
});

describe('W3-10 one "לקשר" queue', () => {
  it('merges SKU lines, no-SKU lines and import suggestions for the same item', () => {
    const rows = buildLinkQueue([
      c({ source: 'sku_line', supplierSku: 'T-1', nameRaw: 'עגבניה', unmappedAgorot: 30000, lineCount: 3 }),
      c({ source: 'import_suggestion', supplierSku: ' t-1 ', nameRaw: 'עגבניה שרי', suggestion: { productId: 'p1', confidence: 0.8 }, lastSeenAt: '2026-10-25T08:00:00.000Z' }),
      c({ source: 'no_sku_line', nameRaw: 'בצל  יבש', unmappedAgorot: 50000, lineCount: 2, suggestion: { productId: 'p2', confidence: 0.4 } }),
      c({ source: 'no_sku_line', nameRaw: 'בצל יבש.', unmappedAgorot: 1, suggestion: { productId: 'p3', confidence: 0.6 } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: linkKey('s1', null, 'בצל יבש'),
      unmappedAgorot: 50001,
      lineCount: 3,
      suggestion: { productId: 'p3', confidence: 0.6 },
    });
    expect(rows[1]).toMatchObject({
      key: 's1|sku:t-1',
      sources: ['sku_line', 'import_suggestion'],
      unmappedAgorot: 30000,
      lineCount: 4,
      nameRaw: 'עגבניה שרי', // the most recent spelling
      suggestion: { productId: 'p1', confidence: 0.8 },
    });
    expect(summarizeLinkQueue(rows)).toEqual({ count: 2, unmappedAgorot: 80001 });
  });

  it('ranks by unmapped ₪, then line count, then most recent; same SKU at two suppliers stays two rows', () => {
    const rows = buildLinkQueue([
      c({ supplierId: 'a', supplierSku: 'K', unmappedAgorot: 100, lineCount: 1 }),
      c({ supplierId: 'b', supplierSku: 'K', unmappedAgorot: 100, lineCount: 5 }),
      c({ supplierId: 'c', nameRaw: 'q', unmappedAgorot: 100, lineCount: 5, lastSeenAt: '2026-10-24T00:00:00.000Z' }),
      c({ supplierId: 'd', nameRaw: 'z', unmappedAgorot: 900 }),
    ]);
    expect(rows.map((r) => r.supplierId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('rejects non-integer or negative agorot (₪ is integer at this boundary)', () => {
    expect(() => buildLinkQueue([c({ unmappedAgorot: 1.5 })])).toThrow(RangeError);
    expect(() => buildLinkQueue([c({ unmappedAgorot: -1 })])).toThrow(RangeError);
  });

  it('an empty queue sums to zero', () => {
    expect(summarizeLinkQueue(buildLinkQueue([]))).toEqual({ count: 0, unmappedAgorot: 0 });
  });
});
