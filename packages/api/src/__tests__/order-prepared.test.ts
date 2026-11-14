import { describe, expect, it } from 'vitest';
import {
  PREPARED_MAX_LINES,
  backorderSourceRef,
  buildPreparedLines,
  isPreparedSourceRef,
  preparedSkipReason,
  preparedSourceRef,
  type GuideRow,
} from '../orders/prepared';

/** W3-09 / AU-11 a · prepared draft, pure core. */
const row = (i: number, usualQty: number | null = 3, frequency = 1): GuideRow => ({
  productId: `p${i}`,
  description: `מוצר ${i}`,
  unit: 'ק״ג',
  usualQty,
  frequency,
});
const ctx = { supplierActive: true, hasPoToday: false, hasOpenHumanDraft: false };

describe('source refs', () => {
  it('one key per supplier per order day; backorder per GR', () => {
    expect(preparedSourceRef('s1', '2026-10-25')).toBe('au:A16:s1:2026-10-25');
    expect(backorderSourceRef('gr9')).toBe('au:A16b:gr9');
    expect(isPreparedSourceRef('au:A16:s1:2026-10-25')).toBe(true);
    expect(isPreparedSourceRef('au:A16b:gr9')).toBe(false);
    expect(() => preparedSourceRef('s1', '25.10.2026')).toThrow();
  });
});

describe('preparedSkipReason', () => {
  it('skips inactive, PO today, a human draft, or a thin guide', () => {
    const rows = [row(1), row(2)];
    expect(preparedSkipReason(ctx, rows)).toBeNull();
    expect(preparedSkipReason({ ...ctx, supplierActive: false }, rows)).toBe('inactive');
    expect(preparedSkipReason({ ...ctx, hasPoToday: true }, rows)).toBe('po_today');
    expect(preparedSkipReason({ ...ctx, hasOpenHumanDraft: true }, rows)).toBe('human_draft');
    expect(preparedSkipReason(ctx, [row(1), row(2, null)])).toBe('thin_guide');
  });
});

describe('buildPreparedLines', () => {
  it('prices only from the resolver; no price stays null', () => {
    const lines = buildPreparedLines([row(1), row(2), row(3)], (r) =>
      r.productId === 'p1' ? { unitPrice: 6.5, source: 'contract' } : r.productId === 'p2' ? { unitPrice: null, source: null } : { unitPrice: 0, source: 'list' },
    );
    expect(lines.map((l) => [l.productId, l.unitPriceExpected, l.priceSource])).toEqual([
      ['p1', 6.5, 'contract'],
      ['p2', null, null],
      ['p3', null, null],
    ]);
  });

  it('keeps the 40 most frequent rows with a usual quantity', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(i, i === 0 ? null : 2, i));
    const lines = buildPreparedLines(rows, () => ({ unitPrice: null, source: null }));
    expect(lines).toHaveLength(PREPARED_MAX_LINES);
    expect(lines[0]!.productId).toBe('p49');
    expect(lines.some((l) => l.productId === 'p0')).toBe(false);
    expect(lines.every((l) => l.qty === 2)).toBe(true);
  });
});
