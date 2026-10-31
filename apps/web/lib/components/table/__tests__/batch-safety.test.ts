import { describe, expect, it } from 'vitest';
import { batchActionState, isHeldBack, selectAllIds, summarize } from '../selection';

/**
 * Pre-merge review findings on the bulk-approve guard (#147):
 * 1 an unknown/pending amount must never be bulk-approvable (it used to pass as ₪0);
 * 2 a capped action stays off unless the host says the server enforces the cap;
 * 3 over-cap rows are excluded only from the capped action, not from export/assign or Σ.
 */
interface R {
  id: string;
  amount: number | null;
  block?: boolean;
}
const rows: R[] = [
  { id: 'small', amount: 5_000 },
  { id: 'pending', amount: null },
  { id: 'big', amount: 50_000 },
  { id: 'blocked', amount: 1_000, block: true },
];
const rules = {
  rowKey: (r: R) => r.id,
  selectable: (r: R) => (r.block ? { disabled: 'דורש בדיקה פרטנית' } : (true as const)),
  amountAgorot: (r: R) => r.amount,
};
const all = new Set(rows.map((r) => r.id));

describe('unknown amounts fail closed (finding 1)', () => {
  it('an unknown amount is held back, never ₪0', () => {
    expect(isHeldBack(rules, rows[1]!)).toBe('unknown');
    expect(isHeldBack(rules, { id: 'nan', amount: Number.NaN })).toBe('unknown');
    expect(isHeldBack(rules, rows[2]!)).toBe('overCap');
    expect(isHeldBack(rules, rows[0]!)).toBeNull();
  });
  it('select-all skips unknown and over-cap rows', () => {
    expect(selectAllIds(rules, rows)).toEqual(['small']);
  });
  it('a capped action is disabled, with a reason, while an unknown row is selected', () => {
    const s = summarize(rules, rows, new Set(['small', 'pending']));
    const st = batchActionState({ capped: true, serverEnforced: true }, s);
    expect(st.disabled).toBe(true);
    expect(st.reason).toBe('unknown');
  });
});

describe('server enforcement gate (finding 2)', () => {
  it('a capped action stays disabled unless the host passes serverEnforced', () => {
    const s = summarize(rules, rows, new Set(['small']));
    expect(batchActionState({ capped: true }, s)).toMatchObject({ disabled: true, reason: 'notEnforced' });
    expect(batchActionState({ capped: true, serverEnforced: true }, s)).toMatchObject({ disabled: false, reason: null });
  });
});

describe('only the capped action drops held-back rows (finding 3)', () => {
  const s = summarize(rules, rows, all);
  it('summary keeps every eligible selected row; block rows never count', () => {
    expect(s.selected.map((r) => r.id)).toEqual(['small', 'pending', 'big']);
    expect(s.count).toBe(3);
    // Σ covers every known amount in the selection; the unknown one is flagged, not summed as 0.
    expect(s.sumAgorot).toBe(55_000);
    expect(s.unknownCount).toBe(1);
  });
  it('a non-capped action gets every selected row', () => {
    const st = batchActionState({}, s);
    expect(st.disabled).toBe(false);
    expect(st.rows.map((r) => r.id)).toEqual(['small', 'pending', 'big']);
  });
  it('a capped action targets only in-cap known rows and is disabled while others are selected', () => {
    const st = batchActionState({ capped: true, serverEnforced: true }, s);
    expect(st.rows.map((r) => r.id)).toEqual(['small']);
    expect(st.sumAgorot).toBe(5_000);
    expect(st.disabled).toBe(true);
    expect(st.reason).toBe('unknown');
    const onlyBig = summarize(rules, rows, new Set(['small', 'big']));
    expect(batchActionState({ capped: true, serverEnforced: true }, onlyBig).reason).toBe('overCap');
  });
});
