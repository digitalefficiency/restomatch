import { describe, expect, it } from 'vitest';
import { LAB_COPY } from '../_copy';
import { LAB_ROW_COUNT, LAB_VIEWS, inView, labRows, viewTotals } from '../_data';

describe('desk lab data', () => {
  it('is 500 deterministic rows with integer agorot', () => {
    const rows = labRows();
    expect(rows).toHaveLength(LAB_ROW_COUNT);
    expect(rows.every((r) => Number.isInteger(r.totalAgorot) && Number.isInteger(r.deltaAgorot))).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(LAB_ROW_COUNT);
    expect(rows.some((r) => r.severity === 'block')).toBe(true);
  });
  it('view totals are Σ|Δ| over every row of the view', () => {
    const rows = labRows();
    for (const v of LAB_VIEWS) {
      const t = viewTotals(rows, v);
      const inV = rows.filter((r) => inView(r, v));
      expect(t.count).toBe(inV.length);
      expect(t.sumAgorot).toBe(inV.reduce((s, r) => s + Math.abs(r.deltaAgorot), 0));
    }
    expect(viewTotals(rows, 'all').count).toBe(LAB_ROW_COUNT);
  });
  it('lab copy has he/en parity', () => {
    expect(Object.keys(LAB_COPY.en).sort()).toEqual(Object.keys(LAB_COPY.he).sort());
  });
});
