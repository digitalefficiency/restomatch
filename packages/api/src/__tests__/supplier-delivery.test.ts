import { describe, expect, it } from 'vitest';
import { nextDelivery, nextDeliveryDay, orderRhythm } from '../ledger/overview';

/** W2-11 lab fix: "משלוח הבא" from an open order, else the order schedule, else the saved delivery days. */
const TZ = 'Asia/Jerusalem';
// Wed 11.11.2026 10:00 IL (UTC+2) = 08:00Z.
const NOW = new Date('2026-11-11T08:00:00Z');

describe('nextDeliveryDay — the saved delivery days', () => {
  it('Monday 09:30 saved → next Monday 16.11, 09:30', () => {
    const d = nextDeliveryDay({ mon: ['09:30'] }, NOW, TZ);
    expect(d).toMatchObject({ time: '09:30', source: 'days' });
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d!.at))).toBe('2026-11-16');
  });

  it('today counts while its time is still ahead; a passed time rolls a week', () => {
    const ahead = nextDeliveryDay({ wed: ['12:00'] }, NOW, TZ);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ahead!.at))).toBe('2026-11-11');
    const passed = nextDeliveryDay({ wed: ['09:00'] }, NOW, TZ);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(passed!.at))).toBe('2026-11-18');
  });

  it('no saved days → null', () => {
    expect(nextDeliveryDay(null, NOW, TZ)).toBeNull();
    expect(nextDeliveryDay({}, NOW, TZ)).toBeNull();
  });
});

describe('nextDelivery — the precedence', () => {
  const schedule = { windows: [{ orderDays: [3], cutoff: '12:00', fulfillment: { kind: 'lead_days' as const, leadDays: 1 } }] };

  it('an open order due wins over the schedule and the saved days', () => {
    const order = new Date('2026-11-13T07:00:00Z'); // Fri 13.11
    const d = nextDelivery(order, orderRhythm(schedule, null, NOW, TZ), { fri: ['08:00'] }, NOW, TZ);
    expect(d).toMatchObject({ source: 'order', time: '08:00' });
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d!.at))).toBe('2026-11-13');
  });

  it('no open order → the order schedule', () => {
    expect(nextDelivery(null, orderRhythm(schedule, null, NOW, TZ), null, NOW, TZ)?.source).toBe('schedule');
  });

  it('no order and no schedule → the saved delivery day', () => {
    expect(nextDelivery(null, null, { mon: ['09:30'] }, NOW, TZ)).toMatchObject({ source: 'days', time: '09:30' });
  });

  it('nothing known → null (shown as "—", never a guess)', () => {
    expect(nextDelivery(null, null, null, NOW, TZ)).toBeNull();
  });
});
