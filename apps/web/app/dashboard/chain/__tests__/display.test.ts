import { describe, expect, it } from 'vitest';
import { chainSparkline, wholeShekelRows } from '../display';

describe('chainSparkline (G-16 money-swallow)', () => {
  const months = ['2026-09', '2026-10'];
  it('sums each month over the branches, in agorot', () => {
    const heat = [
      { cells: [{ month: '2026-09', leakIls: 0.1 }, { month: '2026-10', leakIls: 5 }] },
      { cells: [{ month: '2026-09', leakIls: 0.2 }, { month: '2026-10', leakIls: 0 }] },
    ];
    expect(chainSparkline(months, heat)).toEqual([0.3, 5]);
  });
  it('a missing month cell makes the sparkline unavailable, never ₪0', () => {
    const heat = [
      { cells: [{ month: '2026-09', leakIls: 4 }, { month: '2026-10', leakIls: 5 }] },
      { cells: [{ month: '2026-10', leakIls: 1 }] },
    ];
    expect(chainSparkline(months, heat)).toBeNull();
  });
  it('a null / NaN leak is unavailable too', () => {
    expect(chainSparkline(months, [{ cells: [{ month: '2026-09', leakIls: null }, { month: '2026-10', leakIls: 1 }] }])).toBeNull();
    expect(chainSparkline(months, [{ cells: [{ month: '2026-09', leakIls: Number.NaN }, { month: '2026-10', leakIls: 1 }] }])).toBeNull();
  });
  it('no branches ⇒ an all-zero series only because there is nothing to sum', () => {
    expect(chainSparkline(months, [])).toEqual([0, 0]);
  });
});

describe('wholeShekelRows', () => {
  it('prints rows like each branch dashboard and totals their sum', () => {
    expect(wholeShekelRows([759.5, 0.49])).toEqual({ rows: [760, 0], total: 760 });
  });
});
