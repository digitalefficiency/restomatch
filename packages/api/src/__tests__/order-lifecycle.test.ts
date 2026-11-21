import { describe, expect, it } from 'vitest';
import {
  PO_STATUSES,
  PO_TRANSITIONS,
  canTransitionPo,
  isPoLate,
  poTransitionForEvent,
  type PoStatus,
} from '../orders/lifecycle';

/** W3-09 · one PO transition table, fired by events. Pure. */
describe('PO transition table', () => {
  it('covers every po_status and never leaves a terminal state', () => {
    expect(Object.keys(PO_TRANSITIONS).sort()).toEqual([...PO_STATUSES].sort());
    for (const to of PO_STATUSES) {
      expect(canTransitionPo('closed', to)).toBe(false);
      expect(canTransitionPo('cancelled', to)).toBe(false);
    }
  });

  it('never moves backwards', () => {
    const order: PoStatus[] = ['draft', 'sent', 'confirmed', 'partial', 'closed'];
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < i; j++) expect(canTransitionPo(order[i]!, order[j]!)).toBe(false);
    }
  });

  it('a partially received PO cannot be cancelled (goods arrived)', () => {
    expect(canTransitionPo('partial', 'cancelled')).toBe(false);
  });
});

describe('poTransitionForEvent', () => {
  it('supplier confirm: sent → confirmed', () => {
    expect(poTransitionForEvent('sent', { type: 'supplier.confirmed' })).toEqual({ kind: 'move', from: 'sent', to: 'confirmed' });
  });

  it('supplier confirm after the goods arrived is a no-op, not an error', () => {
    expect(poTransitionForEvent('partial', { type: 'supplier.confirmed' }).kind).toBe('noop');
    expect(poTransitionForEvent('closed', { type: 'supplier.confirmed' }).kind).toBe('noop');
  });

  it('supplier confirm on a draft is refused (nothing was sent)', () => {
    expect(poTransitionForEvent('draft', { type: 'supplier.confirmed' }).kind).toBe('refused');
  });

  it('receipt closed partial → partial', () => {
    const t = poTransitionForEvent('confirmed', { type: 'receipt.closed', receiptStatus: 'partial', allInvoicesMatched: false });
    expect(t).toEqual({ kind: 'move', from: 'confirmed', to: 'partial' });
  });

  it('receipt completed closes only once every invoice is matched', () => {
    expect(poTransitionForEvent('sent', { type: 'receipt.closed', receiptStatus: 'completed', allInvoicesMatched: false })).toEqual({
      kind: 'noop',
      reason: 'not_applicable',
    });
    expect(poTransitionForEvent('partial', { type: 'receipt.closed', receiptStatus: 'completed', allInvoicesMatched: true })).toEqual({
      kind: 'move',
      from: 'partial',
      to: 'closed',
    });
  });

  it('same status is a no-op (event replay)', () => {
    expect(poTransitionForEvent('confirmed', { type: 'supplier.confirmed' })).toEqual({ kind: 'noop', reason: 'same_status' });
  });

  it('placing and cancelling', () => {
    expect(poTransitionForEvent('draft', { type: 'po.placed' }).kind).toBe('move');
    expect(poTransitionForEvent('draft', { type: 'po.cancelled' }).kind).toBe('move');
    expect(poTransitionForEvent('closed', { type: 'po.cancelled' }).kind).toBe('refused');
  });
});

describe('isPoLate (derived at expected + 60 min)', () => {
  const expected = new Date('2026-10-25T08:00:00Z');
  it('not late within the grace hour, late after it', () => {
    expect(isPoLate('sent', expected, new Date('2026-10-25T09:00:00Z'))).toBe(false);
    expect(isPoLate('sent', expected, new Date('2026-10-25T09:00:01Z'))).toBe(true);
    expect(isPoLate('confirmed', expected, new Date('2026-10-25T10:00:00Z'))).toBe(true);
  });
  it('never late once something arrived, for a draft, or without an expected time', () => {
    const later = new Date('2026-10-26T00:00:00Z');
    for (const s of ['draft', 'partial', 'closed', 'cancelled'] as const) expect(isPoLate(s, expected, later)).toBe(false);
    expect(isPoLate('sent', null, later)).toBe(false);
  });
});
