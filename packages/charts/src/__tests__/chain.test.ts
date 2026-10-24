import { describe, expect, it } from 'vitest';
import { aggregateChain, isThinBase, monthOfPeriodEnd, shiftMonth, supplierMergeKey, type BranchSnapshot } from '../chain';

function snap(over: Partial<BranchSnapshot> & { restaurantId: string; name: string }): BranchSnapshot {
  return {
    periodStart: '2026-09-30T21:00:00.000Z',
    periodEnd: '2026-10-31T22:00:00.000Z',
    leakIls: 0,
    spendIls: 0,
    leakPct: null,
    caughtBeforePaymentIls: 0,
    claimedIls: 0,
    pendingApprovals: 0,
    openDiscrepancies: 0,
    invoiceCount: 0,
    pendingLinkCount: 0,
    previous: null,
    trend: [],
    suppliers: [],
    ...over,
  };
}

describe('monthOfPeriodEnd', () => {
  it('is the local month of the last instant of the period', () => {
    expect(monthOfPeriodEnd('2026-10-31T22:00:00.000Z')).toBe('2026-10');
    expect(monthOfPeriodEnd('2026-12-31T22:00:00.000Z')).toBe('2026-12');
    expect(monthOfPeriodEnd('2027-01-01T00:00:00.000Z')).toBe('2027-01'); // 02:00 local, already January
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', -5)).toBe('2026-05');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('supplierMergeKey', () => {
  it('prefers the business id digits', () => {
    expect(supplierMergeKey('תנובה', '51-234 5678')).toBe('bid:512345678');
    expect(supplierMergeKey('Other name', '512345678')).toBe('bid:512345678');
  });
  it('normalizes names (quotes, בע"מ suffix, spacing, case)', () => {
    const a = supplierMergeKey('דגי  הים בע"מ', null);
    expect(a).toBe(supplierMergeKey('דגי הים', ''));
    expect(a).toBe(supplierMergeKey('דגי הים בע״מ', null));
    expect(supplierMergeKey('Sea Fish Ltd.', null)).toBe(supplierMergeKey('sea fish', null));
  });
  it('strips בע"מ only as a whole word (not inside "בעמק")', () => {
    expect(supplierMergeKey('ירקות בעמק', null)).toBe('name:ירקות בעמק');
    expect(supplierMergeKey('ירקות בעמק', null)).not.toBe(supplierMergeKey('ירקות ק', null));
  });
  it('returns null when nothing is usable', () => {
    expect(supplierMergeKey(null, null)).toBeNull();
    expect(supplierMergeKey(' "" ', '12')).toBeNull();
  });
});

describe('aggregateChain', () => {
  const months = ['2026-09', '2026-10'];
  const a = snap({
    restaurantId: 'a',
    name: 'תל אביב',
    leakIls: 572.1,
    spendIls: 28389.35,
    leakPct: 572.1 / 28389.35,
    caughtBeforePaymentIls: 296.05,
    claimedIls: 276.05,
    pendingApprovals: 5,
    openDiscrepancies: 4,
    previous: { leakIls: 400, spendIls: 20000, leakPct: 0.02 },
    trend: [
      { month: months[0]!, leakIls: 400, spendIls: 20000, leakPct: 0.02 },
      { month: months[1]!, leakIls: 572.1, spendIls: 28389.35, leakPct: 572.1 / 28389.35 },
    ],
    suppliers: [
      { supplierId: 's1', name: 'דגי הים בע"מ', nameEn: null, businessId: null, invoiceCount: 3, spendIls: 3000, leakIls: 100.1 },
      { supplierId: 's2', name: 'תנובה', nameEn: 'Tnuva', businessId: '520000001', invoiceCount: 2, spendIls: 2000, leakIls: 0 },
    ],
  });
  const b = snap({
    restaurantId: 'b',
    name: 'ירושלים',
    leakIls: 620.2,
    spendIls: 20000,
    leakPct: 0.03101,
    pendingApprovals: 2,
    openDiscrepancies: 3,
    previous: { leakIls: 700, spendIls: 21000, leakPct: 700 / 21000 },
    trend: [
      { month: months[0]!, leakIls: 700, spendIls: 21000, leakPct: 700 / 21000 },
      { month: months[1]!, leakIls: 620.2, spendIls: 20000, leakPct: 0.03101 },
    ],
    suppliers: [
      { supplierId: 's9', name: 'דגי הים', nameEn: 'Sea Fish', businessId: '', invoiceCount: 4, spendIls: 4000, leakIls: 200.2 },
      { supplierId: 's8', name: 'Tnuva other spelling', nameEn: null, businessId: '520-000-001', invoiceCount: 1, spendIls: 1000, leakIls: 50 },
    ],
  });
  const c = snap({
    restaurantId: 'c',
    name: 'חיפה',
    previous: { leakIls: 0, spendIls: 0, leakPct: null },
    trend: [
      { month: months[0]!, leakIls: 0, spendIls: 0, leakPct: null },
      { month: months[1]!, leakIls: 0, spendIls: 0, leakPct: null },
    ],
  });
  const out = aggregateChain([a, b, c]);

  it('sums money to the agora and computes the chain % as Σleak ÷ Σspend', () => {
    expect(out.totals.leakIls).toBe(1192.3);
    expect(out.totals.spendIls).toBe(48389.35);
    expect(out.totals.leakPct).toBeCloseTo(119230 / 4838935, 12);
    expect(out.totals.caughtBeforePaymentIls).toBe(296.05);
    expect(out.totals.claimedIls).toBe(276.05);
    expect(out.totals.pendingApprovals).toBe(7);
    expect(out.totals.openDiscrepancies).toBe(7);
    expect(out.totals.prevLeakIls).toBe(1100);
    expect(out.totals.prevLeakPct).toBeCloseTo(1100 / 41000, 12);
  });

  it('ranks by leak ₪ and computes the trend vs the previous month', () => {
    expect(out.branches.map((r) => [r.restaurantId, r.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
    expect(out.branches[0]!.leakDeltaIls).toBe(-79.8);
    expect(out.branches[1]!.leakDeltaIls).toBe(172.1);
  });

  it('names the worst branch by leak % (not ₪) and ignores clean branches', () => {
    expect(out.worstBranchId).toBe('b');
    expect(aggregateChain([c]).worstBranchId).toBeNull();
  });

  it('builds the branch × month heatmap in ranking order', () => {
    expect(out.months).toEqual(months);
    expect(out.heatmap.map((h) => h.restaurantId)).toEqual(['b', 'a', 'c']);
    expect(out.heatmap[0]!.cells.map((x) => x.leakIls)).toEqual([700, 620.2]);
  });

  it('merges the same supplier across branches by business id or normalized name', () => {
    const fish = out.topSuppliers.find((s) => s.key.startsWith('name:'))!;
    expect(fish.branchCount).toBe(2);
    expect(fish.leakIls).toBe(300.3);
    expect(fish.spendIls).toBe(7000);
    expect(fish.nameEn).toBe('Sea Fish');
    const tnuva = out.topSuppliers.find((s) => s.key === 'bid:520000001')!;
    expect(tnuva.branchCount).toBe(2);
    expect(tnuva.leakIls).toBe(50);
    expect(out.topSuppliers[0]!.key).toBe(fish.key);
  });

  it('handles an empty chain', () => {
    const empty = aggregateChain([]);
    expect(empty.totals.leakIls).toBe(0);
    expect(empty.totals.leakPct).toBeNull();
    expect(empty.totals.prevLeakIls).toBeNull();
    expect(empty.branches).toEqual([]);
    expect(empty.months).toEqual([]);
    expect(empty.periodStart).toBeNull();
  });

  it('compare off: no comparison totals and no per-branch delta', () => {
    const off = aggregateChain([a, b, c].map((x) => ({ ...x, previous: null })));
    expect(off.totals.prevLeakIls).toBeNull();
    expect(off.totals.prevLeakPct).toBeNull();
    expect(off.branches.every((r) => r.leakDeltaIls === null && r.prevLeakIls === null)).toBe(true);
    expect(off.totals.leakIls).toBe(1192.3);
  });

  it('an empty comparison period gives no delta (not ▲ the whole leak)', () => {
    const empty = aggregateChain([a, b].map((x) => ({ ...x, previous: { leakIls: 0, spendIls: 0, leakPct: null } })));
    expect(empty.branches.every((r) => r.leakDeltaIls === null && r.prevLeakIls === null)).toBe(true);
    expect(empty.totals.prevLeakPct).toBeNull();
  });

  it('normal comparison base: not thin — the % / ▲ stay', () => {
    expect(out.totals.thinBase).toBe(false);
    expect(out.branches.find((r) => r.restaurantId === 'a')!.thinBase).toBe(false);
    expect(out.branches.find((r) => r.restaurantId === 'b')!.thinBase).toBe(false);
  });

  it('thin comparison base (S8: last month vs an almost-empty August): flagged, ₪ delta kept', () => {
    // ₪35 leak on ₪1,200 spend vs ₪1,059 on ₪63,300 → "▲ 2,926.8%" before this rule.
    const thin = aggregateChain([
      { ...a, leakIls: 1059.38, spendIls: 63300.94, previous: { leakIls: 35, spendIls: 1200, leakPct: 35 / 1200 } },
    ]);
    expect(thin.totals.thinBase).toBe(true);
    expect(thin.branches[0]!.thinBase).toBe(true);
    expect(thin.branches[0]!.leakDeltaIls).toBe(1024.38); // the calm ₪ difference is still there
  });

  it('isThinBase: base spend under 10% of the current period', () => {
    expect(isThinBase(63300, 1200)).toBe(true);
    expect(isThinBase(63300, 6330)).toBe(false); // exactly 10% is a real base
    expect(isThinBase(28389, 42263)).toBe(false); // a bigger base is never thin
    expect(isThinBase(1000, null)).toBe(false); // compare off
    expect(isThinBase(0, 0)).toBe(false);
  });

  it('reports the selected period bounds', () => {
    expect(out.periodStart).toBe('2026-09-30T21:00:00.000Z');
    expect(out.periodEnd).toBe('2026-10-31T22:00:00.000Z');
  });
});
