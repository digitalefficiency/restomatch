import { describe, expect, it } from 'vitest';
import { resolvedNoteState, settle } from '../report/money-read';

/** G-16 money-swallow (routed to W3-08): a failed money read is "unavailable", never empty / ₪0. */
describe('settle', () => {
  it('keeps the value of a read that worked, and marks a failed one', async () => {
    expect(await settle(Promise.resolve([1, 2]))).toEqual({ ok: true, value: [1, 2] });
    expect(await settle(Promise.reject(new Error('db down')))).toEqual({ ok: false });
  });
});

describe('resolvedNoteState', () => {
  const compute = (l: number[], t: number[]) => l.filter((x) => !t.includes(x));
  it('is off when the tracker is off', () => {
    expect(resolvedNoteState({ ok: true, value: [1] }, null, compute)).toEqual({ kind: 'off' });
  });
  it('is unavailable when either read failed (never an empty list)', () => {
    expect(resolvedNoteState({ ok: false }, { ok: true, value: [1] }, compute)).toEqual({ kind: 'unavailable' });
    expect(resolvedNoteState({ ok: true, value: [1] }, { ok: false }, compute)).toEqual({ kind: 'unavailable' });
  });
  it('computes the items when both reads worked, including none', () => {
    expect(resolvedNoteState({ ok: true, value: [1, 2] }, { ok: true, value: [2] }, compute)).toEqual({ kind: 'items', items: [1] });
    expect(resolvedNoteState({ ok: true, value: [2] }, { ok: true, value: [2] }, compute)).toEqual({ kind: 'items', items: [] });
  });
});
