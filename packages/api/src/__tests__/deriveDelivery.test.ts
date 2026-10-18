import { describe, expect, it } from 'vitest';
import type { OrderSchedule } from '@restomatch/types';
import { deriveExpectedDelivery } from '../lib/deriveDelivery';

const TZ = 'Asia/Jerusalem';

/** Local 'YYYY-MM-DD' an instant shows in `tz` (golden delivery-day assertions). */
const localDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Local weekday name in `tz` (sanity on weekend skips). */
const localWeekday = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);

describe('deriveExpectedDelivery — golden fixtures', () => {
  it('no schedule → null (manual entry stays the source of truth)', () => {
    expect(deriveExpectedDelivery(null, new Date('2026-06-15T06:00:00Z'), TZ)).toBeNull();
    expect(deriveExpectedDelivery(undefined, new Date('2026-06-15T06:00:00Z'), TZ)).toBeNull();
  });

  it('lead_days happy path: order before cutoff delivers next day', () => {
    // Mon 2026-06-15, order at 08:00 IDT (=05:00Z), cutoff 12:00, lead 1 day.
    const schedule: OrderSchedule = {
      windows: [{ orderDays: [0, 1, 2, 3, 4], cutoff: '12:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }],
    };
    const res = deriveExpectedDelivery(schedule, new Date('2026-06-15T05:00:00Z'), TZ);
    expect(res).not.toBeNull();
    expect(res!.missedCutoff).toBe(false);
    // +1 day from Mon = Tue 2026-06-16 (deliverable weekday).
    expect(localDay(res!.expectedDeliveryAt)).toBe('2026-06-16');
    expect(localWeekday(res!.expectedDeliveryAt)).toBe('Tue');
  });

  it('post-cutoff roll: order AFTER cutoff signals missedCutoff and rolls forward', () => {
    // Mon 2026-06-15, order at 15:00 IDT (=12:00Z), cutoff 12:00 → missed.
    const schedule: OrderSchedule = {
      windows: [{ orderDays: [0, 1, 2, 3, 4], cutoff: '12:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }],
    };
    const res = deriveExpectedDelivery(schedule, new Date('2026-06-15T12:00:01Z'), TZ);
    expect(res).not.toBeNull();
    expect(res!.missedCutoff).toBe(true);
    // Roll to next order day = Tue 2026-06-16, +1 lead = Wed 2026-06-17.
    expect(localDay(res!.expectedDeliveryAt)).toBe('2026-06-17');
    expect(localWeekday(res!.expectedDeliveryAt)).toBe('Wed');
  });

  it('weekend skip: a lead_days target landing on Fri/Sat advances to Sunday', () => {
    // Thu 2026-06-18, cutoff 23:00, order 08:00 IDT, lead 1 → Fri (skip) → Sat (skip) → Sun.
    const schedule: OrderSchedule = {
      windows: [{ orderDays: [4], cutoff: '23:00', fulfillment: { kind: 'lead_days', leadDays: 1 } }],
    };
    const res = deriveExpectedDelivery(schedule, new Date('2026-06-18T05:00:00Z'), TZ);
    expect(res).not.toBeNull();
    expect(res!.missedCutoff).toBe(false);
    // 2026-06-18 is Thu; +1 = Fri 06-19 (skip), Sat 06-20 (skip), Sun 06-21.
    expect(localWeekday(res!.expectedDeliveryAt)).toBe('Sun');
    expect(localDay(res!.expectedDeliveryAt)).toBe('2026-06-21');
  });

  it('next_named_day week-skip: order day AFTER the named day rolls to next week', () => {
    // Named delivery day = Tuesday (2). Order placed Wed before cutoff → the next
    // Tuesday is a full week out, NOT the Tuesday that already passed.
    const schedule: OrderSchedule = {
      windows: [{ orderDays: [3], cutoff: '18:00', fulfillment: { kind: 'next_named_day', deliversOnDay: 2 } }],
    };
    // Wed 2026-06-17, 10:00 IDT (=07:00Z), before 18:00 cutoff.
    const res = deriveExpectedDelivery(schedule, new Date('2026-06-17T07:00:00Z'), TZ);
    expect(res).not.toBeNull();
    expect(res!.missedCutoff).toBe(false);
    // Next Tuesday at/after Wed 06-17 is 06-23.
    expect(localWeekday(res!.expectedDeliveryAt)).toBe('Tue');
    expect(localDay(res!.expectedDeliveryAt)).toBe('2026-06-23');
  });
});
