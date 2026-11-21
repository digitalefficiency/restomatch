import { describe, expect, it } from 'vitest';
import { canEditSupplier, windowParts } from '../[id]/read-only';

/** IA warden (#274): a role that can't write suppliers sees values, never an edit form. */
describe('W2-11 · supplier read-only for non-writers', () => {
  it('only owner and manager edit (the same roles as suppliers.update / setActive)', () => {
    expect(canEditSupplier('owner')).toBe(true);
    expect(canEditSupplier('manager')).toBe(true);
    for (const role of ['bookkeeper', 'receiver', 'chef', '', null, undefined]) {
      expect(canEditSupplier(role)).toBe(false);
    }
  });

  it('a window reads as days, cutoff and delivery', () => {
    expect(windowParts({ orderDays: [3, 1], cutoff: '12:00', fulfillment: { kind: 'lead_days', leadDays: 1 } })).toEqual({
      days: ['mon', 'wed'],
      cutoff: '12:00',
      delivery: { kind: 'lead', days: 1 },
    });
    expect(windowParts({ orderDays: [0], cutoff: '09:30', fulfillment: { kind: 'next_named_day', deliversOnDay: 2 } }).delivery).toEqual({
      kind: 'named',
      day: 'tue',
    });
  });
});
