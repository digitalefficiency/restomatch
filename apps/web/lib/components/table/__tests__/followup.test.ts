import { describe, expect, it } from 'vitest';
import { exportTable } from '../exportCsv';
import { batchActionState, sumDisplay, summarize } from '../selection';
import type { ColumnDef } from '../types';

/** Verification leftovers on W1-02 (#147 → wave-1 follow-up). */
interface R {
  id: string;
  amount: number | null;
}
const rules = { rowKey: (r: R) => r.id, amountAgorot: (r: R) => r.amount };
const rows: R[] = [
  { id: 'fifty', amount: 5_000 },
  { id: 'pending', amount: null },
  { id: 'pending2', amount: null },
];

describe('an unknown amount never reads as ₪0 (DoD-5)', () => {
  it('all-unknown selection renders the pending state, not 0.00', () => {
    const s = summarize(rules, rows, new Set(['pending']));
    expect(sumDisplay(s)).toEqual({ kind: 'pending' });
  });
  it('a mixed selection shows the known Σ plus how many are unknown', () => {
    const s = summarize(rules, rows, new Set(['fifty', 'pending', 'pending2']));
    expect(sumDisplay(s)).toEqual({ kind: 'sum', sumAgorot: 5_000, unknownCount: 2 });
  });
  it('a fully known selection is a plain Σ', () => {
    expect(sumDisplay(summarize(rules, rows, new Set(['fifty'])))).toEqual({ kind: 'sum', sumAgorot: 5_000, unknownCount: 0 });
  });
  it('CSV writes the pending label for an unknown money cell, never blank or 0', () => {
    const cols: ColumnDef<R>[] = [
      { id: 'id', header: 'id', identity: true, value: (r) => r.id },
      { id: 'amount', header: 'פער', kind: 'money', value: (r) => r.amount },
    ];
    const out = exportTable(cols, rows, undefined, 'ממתין');
    expect(out.rows.map((r) => r.amount)).toEqual([50, 'ממתין', 'ממתין']);
  });
});

describe('a capped action never runs uncapped', () => {
  it('without an amountAgorot accessor the capped action is held back as unknown', () => {
    const noAmount = { rowKey: (r: R) => r.id };
    const s = summarize(noAmount, rows, new Set(['fifty']));
    expect(batchActionState({ capped: true, serverEnforced: true }, s)).toMatchObject({
      disabled: true,
      reason: 'unknown',
      rows: [],
    });
    // A non-capped action is unaffected.
    expect(batchActionState({}, s).disabled).toBe(false);
  });
});
