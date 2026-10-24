import { describe, expect, it } from 'vitest';
import { wholeShekelRows } from '../chain/display';

describe('wholeShekelRows (chain ranking display)', () => {
  it('the seeded demo month: rows keep each branch dashboard number and add up to the printed total', () => {
    // main ₪759.54 (its dashboard shows 760), Haifa ₪354.86, Jerusalem ₪975.07.
    const { rows, total } = wholeShekelRows([759.54, 354.86, 975.07]);
    expect(rows).toEqual([760, 355, 975]);
    expect(total).toBe(2090);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(total);
  });
  it('last month: caught + claimed printed per branch add up to the printed leak (₪1,892, not 0 + 1,893)', () => {
    // main / Haifa / Jerusalem, all of last month's leak already claimed back.
    const leak = wholeShekelRows([1059.38, 212.29, 621.47]);
    const caught = wholeShekelRows([0, 0, 0]);
    const claimed = wholeShekelRows([1059.38, 212.29, 621.47]);
    expect(leak.total).toBe(1892);
    expect(caught.total + claimed.total).toBe(leak.total);
  });

  it('whole shekels, zeros and an empty chain', () => {
    expect(wholeShekelRows([100, 0, 40])).toEqual({ rows: [100, 0, 40], total: 140 });
    expect(wholeShekelRows([])).toEqual({ rows: [], total: 0 });
  });
  it('rounds half up like the hero (formatIls)', () => {
    expect(wholeShekelRows([0.5, 0.49])).toEqual({ rows: [1, 0], total: 1 });
  });
});
