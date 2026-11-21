import { describe, expect, it } from 'vitest';
import { OVERDUE_DAYS, REMIND_EVERY_DAYS } from '../../../recovery/service';
import { CHASE_COURTESY_DAY3, chaseStepDue } from '../chaseCadence';

// A letter sent Sun 1.11.2026 10:00 IL (08:00Z).
const sentAt = new Date('2026-11-01T08:00:00Z');
const at = (isoDay: string, hourZ = 7) => new Date(`${isoDay}T${String(hourZ).padStart(2, '0')}:00:00Z`);

describe('chase cadence reconciled with the 7-day rule', () => {
  it('pins the owner constants it depends on', () => {
    expect(OVERDUE_DAYS).toBe(7);
    expect(REMIND_EVERY_DAYS).toBe(7);
    expect(CHASE_COURTESY_DAY3).toBe(false);
  });

  it('nothing before the request is overdue (no day-3 chase by default)', () => {
    for (const day of ['2026-11-02', '2026-11-04', '2026-11-08']) {
      expect(chaseStepDue({ sentAt, now: at(day), lastReminderAt: null, remindersSoFar: 0 })).toBeNull();
    }
  });

  it('first reminder the day it becomes overdue (calendar days > 7, same rule as overdueSql)', () => {
    expect(chaseStepDue({ sentAt, now: at('2026-11-09'), lastReminderAt: null, remindersSoFar: 0 })).toEqual({
      kind: 'reminder',
      ageDays: 8,
      nth: 1,
    });
  });

  it('then again only every REMIND_EVERY_DAYS', () => {
    const last = at('2026-11-09');
    expect(chaseStepDue({ sentAt, now: at('2026-11-15'), lastReminderAt: last, remindersSoFar: 1 })).toBeNull();
    expect(chaseStepDue({ sentAt, now: at('2026-11-16'), lastReminderAt: last, remindersSoFar: 1 })).toEqual({
      kind: 'reminder',
      ageDays: 15,
      nth: 2,
    });
  });

  it('the day-3 courtesy appears only when the owner turns it on, once, and never once overdue', () => {
    const on = { lastReminderAt: null, remindersSoFar: 0, courtesyDay3: true };
    expect(chaseStepDue({ sentAt, now: at('2026-11-03'), ...on })).toBeNull();
    expect(chaseStepDue({ sentAt, now: at('2026-11-04'), ...on })).toEqual({ kind: 'courtesy', ageDays: 3 });
    expect(chaseStepDue({ sentAt, now: at('2026-11-05'), ...on, courtesyDrafted: true })).toBeNull();
    expect(chaseStepDue({ sentAt, now: at('2026-11-09'), ...on })?.kind).toBe('reminder');
  });

  it('counts Israel calendar days, not UTC days', () => {
    // Sent Sat 31.10 23:30 IL (21:30Z) is IL day 31.10; 8.11 23:30 IL (21:30Z) is IL day 8.11 → 8 days.
    const lateSent = new Date('2026-10-31T21:30:00Z');
    expect(chaseStepDue({ sentAt: lateSent, now: new Date('2026-11-08T21:30:00Z'), lastReminderAt: null, remindersSoFar: 0 })).toEqual({
      kind: 'reminder',
      ageDays: 8,
      nth: 1,
    });
  });
});
