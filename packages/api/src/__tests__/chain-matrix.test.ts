import { describe, expect, it } from 'vitest';
import type { BranchSnapshot } from '@restomatch/charts';
import {
  buildMatrix,
  completenessOf,
  matrixCellState,
  parseBranchScope,
  resolveMatrixScope,
  type MatrixExtras,
  type MembershipRow,
} from '../routers/chain';

/** W3-01 · pure parts of the chain matrix (no DB). The RLS side lives in chain.attack.test.ts. */

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const G = '99999999-9999-4999-8999-999999999999';

describe('parseBranchScope', () => {
  it('reads all | <uuid> | g:<uuid>', () => {
    expect(parseBranchScope('all')).toEqual({ kind: 'all' });
    expect(parseBranchScope(U1)).toEqual({ kind: 'branch', restaurantId: U1 });
    expect(parseBranchScope(U1.toUpperCase())).toEqual({ kind: 'branch', restaurantId: U1 });
    expect(parseBranchScope(`g:${G}`)).toEqual({ kind: 'group', billingAccountId: G });
  });
  it('anything else is all (a broken link widens nothing server-side)', () => {
    for (const v of [undefined, null, 42, '', 'g:', 'g:abc', `${U1}x`, `b:${U1}`, "'; drop"]) {
      expect(parseBranchScope(v)).toEqual({ kind: 'all' });
    }
  });
});

describe('resolveMatrixScope', () => {
  const row = (id: string, role: MembershipRow['role'], acct: string | null, name = id): MembershipRow => ({
    restaurantId: id,
    name,
    role,
    billingAccountId: acct,
  });
  const rows = [
    row('a', 'owner', 'k', 'ב'),
    row('a2', 'owner', 'k', 'א'),
    row('m', 'manager', 'k'),
    row('bk', 'bookkeeper', 'k'),
    row('x', 'owner', 'z'),
  ];

  it('owner pool = owner rows on the active account, sorted by Hebrew name', () => {
    const s = resolveMatrixScope(rows, 'a', { kind: 'all' });
    expect(s.lens).toBe('owner');
    expect(s.pool.map((r) => r.restaurantId)).toEqual(['a2', 'a']);
    expect(s.branches).toEqual(s.pool);
  });
  it('bookkeeper lens lists only bookkeeper rows on the same account', () => {
    const s = resolveMatrixScope([...rows, row('bk2', 'bookkeeper', 'k'), row('bkz', 'bookkeeper', 'z')], 'bk', { kind: 'all' });
    expect(s.lens).toBe('bookkeeper');
    expect(s.pool.map((r) => r.restaurantId).sort()).toEqual(['bk', 'bk2']);
  });
  it('manager / receiver / chef / non-member active branch → FORBIDDEN', () => {
    expect(() => resolveMatrixScope(rows, 'm', { kind: 'all' })).toThrow(/owner \/ bookkeeper/);
    expect(() => resolveMatrixScope(rows, 'nope', { kind: 'all' })).toThrow(/owner \/ bookkeeper/);
    expect(() => resolveMatrixScope(rows, null, { kind: 'all' })).toThrow(/owner \/ bookkeeper/);
  });
  it('a branch or group outside the pool → NOT_FOUND', () => {
    expect(resolveMatrixScope(rows, 'a', { kind: 'branch', restaurantId: 'a2' }).branches.map((r) => r.restaurantId)).toEqual(['a2']);
    expect(() => resolveMatrixScope(rows, 'a', { kind: 'branch', restaurantId: 'm' })).toThrow(/not found/);
    expect(() => resolveMatrixScope(rows, 'a', { kind: 'branch', restaurantId: 'x' })).toThrow(/not found/);
    expect(resolveMatrixScope(rows, 'a', { kind: 'group', billingAccountId: 'k' }).branches).toHaveLength(2);
    expect(() => resolveMatrixScope(rows, 'a', { kind: 'group', billingAccountId: 'z' })).toThrow(/not found/);
  });
  it('no billing account ⇒ the active branch alone, and no group matches', () => {
    const solo = [row('s', 'owner', null), row('t', 'owner', null)];
    expect(resolveMatrixScope(solo, 's', { kind: 'all' }).pool.map((r) => r.restaurantId)).toEqual(['s']);
    expect(() => resolveMatrixScope(solo, 's', { kind: 'group', billingAccountId: 'k' })).toThrow(/not found/);
  });
});

describe('matrixCellState / completenessOf', () => {
  const s = (invoiceCount: number, pendingLinkCount: number, leakIls: number, spendIls: number) =>
    matrixCellState({ invoiceCount, pendingLinkCount, leakIls, spendIls });
  it('no data (T4) · pending · clean (T3) · leak', () => {
    expect(s(0, 0, 0, 0)).toBe('no_data');
    expect(s(0, 2, 0, 0)).toBe('pending');
    expect(s(3, 1, 0, 500)).toBe('clean');
    expect(s(3, 0, 12.5, 500)).toBe('leak');
  });
  it('completeness never invents 100%', () => {
    expect(completenessOf(0, 0)).toBeNull();
    expect(completenessOf(3, 1)).toBe(0.75);
    expect(completenessOf(4, 0)).toBe(1);
  });
});

function snap(id: string, name: string, leakIls: number, spendIls: number, extra: Partial<BranchSnapshot> = {}): BranchSnapshot {
  return {
    restaurantId: id,
    name,
    periodStart: '2026-09-30T21:00:00.000Z',
    periodEnd: '2026-10-31T22:00:00.000Z',
    leakIls,
    spendIls,
    leakPct: spendIls > 0 ? leakIls / spendIls : null,
    caughtBeforePaymentIls: 0,
    claimedIls: 0,
    pendingApprovals: 1,
    openDiscrepancies: 1,
    invoiceCount: spendIls > 0 ? 2 : 0,
    pendingLinkCount: 0,
    previous: null,
    trend: [{ month: '2026-10', leakIls, spendIls, leakPct: spendIls > 0 ? leakIls / spendIls : null }],
    suppliers: [],
    ...extra,
  };
}
const ext = (awaitingIls: number, openCreditIls: number | null, recoveredIls: number | null): MatrixExtras => ({
  awaitingIls,
  awaitingCount: awaitingIls > 0 ? 1 : 0,
  openCreditIls,
  recoveredIls,
});

describe('buildMatrix', () => {
  it('the total row is aggregateChain over the OK rows; added columns sum in agorot (0.1 + 0.2 = 0.3 exactly)', () => {
    const m = buildMatrix(
      [
        { ok: true, snapshot: snap(U1, 'א', 0.1, 100), extras: ext(0.1, 0.1, 0.2) },
        { ok: true, snapshot: snap(U2, 'ב', 0.2, 100), extras: ext(0.2, 0.2, null) },
      ],
      U1,
    );
    expect(m.totals.leakIls).toBe(0.3);
    expect(m.totals.spendIls).toBe(200);
    expect(m.totals.awaitingIls).toBe(0.3);
    expect(m.totals.openCreditIls).toBe(0.3);
    expect(m.totals.recoveredIls).toBe(0.2);
    expect(m.totals.partial).toBe(false);
    expect(m.totals.completeness).toBe(1);
    expect(m.branches.map((b) => b.restaurantId)).toEqual([U1, U2]);
    expect(m.branches[0]).toMatchObject({ status: 'ok', isActive: true, state: 'leak', rank: 2 });
    expect(m.worstBranchId).toBe(U2);
    expect(m.months).toEqual(['2026-10']);
  });

  it('a failed branch is an error row; the total covers the rest and is marked partial', () => {
    const m = buildMatrix(
      [
        { ok: false, restaurantId: U1, name: 'א' },
        { ok: true, snapshot: snap(U2, 'ב', 0, 0), extras: ext(0, null, null) },
      ],
      U2,
    );
    expect(m.branches[0]).toEqual({ status: 'error', restaurantId: U1, name: 'א', isActive: false });
    expect(m.branches[1]).toMatchObject({ status: 'ok', state: 'no_data', completeness: null });
    expect(m.totals.partial).toBe(true);
    expect(m.totals.leakIls).toBe(0);
    expect(m.totals.openCreditIls).toBeNull();
    expect(m.totals.completeness).toBeNull();
    expect(m.worstBranchId).toBeNull();
  });

  it('every branch failed: an empty, partial total (never a crash)', () => {
    const m = buildMatrix([{ ok: false, restaurantId: U1, name: 'א' }], U1);
    expect(m.totals.partial).toBe(true);
    expect(m.months).toEqual([]);
    expect(m.periodStart).toBeNull();
  });
});
