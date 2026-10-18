import { describe, expect, it } from 'vitest';
import { addCalendarDaysInTz, endOfDayInTz, startOfDayInTz } from '../lib/time';

const TZ = 'Asia/Jerusalem';

/** The local wall-clock string an instant shows in `tz` (for golden assertions). */
const local = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);

describe('timezone day boundaries (Intl, DST-safe)', () => {
  it('an instant at 22:00 Asia/Jerusalem maps to the SAME local day, not the next', () => {
    // 2026-01-15 22:00 IST (winter, +02:00) == 2026-01-15T20:00:00Z.
    const at22Local = new Date('2026-01-15T20:00:00Z');
    expect(local(at22Local, TZ)).toBe('2026-01-15, 22:00:00');

    const start = startOfDayInTz(at22Local, TZ);
    const end = endOfDayInTz(at22Local, TZ);
    // Start = local midnight of the 15th = 2026-01-14T22:00:00Z (+02:00).
    expect(local(start, TZ)).toBe('2026-01-15, 00:00:00');
    expect(start.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    // End = 23:59:59.999 local of the same day.
    expect(local(end, TZ)).toBe('2026-01-15, 23:59:59');
    expect(end.toISOString()).toBe('2026-01-15T21:59:59.999Z');
  });

  it('a UTC late-night instant that is already the NEXT local day rolls forward', () => {
    // 2026-01-15T23:30:00Z == 2026-01-16 01:30 IST. Local day must be the 16th.
    const ref = new Date('2026-01-15T23:30:00Z');
    expect(local(ref, TZ)).toBe('2026-01-16, 01:30:00');
    expect(local(startOfDayInTz(ref, TZ), TZ)).toBe('2026-01-16, 00:00:00');
  });

  it('startOfDay is idempotent and end is exactly start + ~1 day - 1ms', () => {
    const ref = new Date('2026-06-19T09:00:00Z');
    const start = startOfDayInTz(ref, TZ);
    expect(startOfDayInTz(start, TZ).toISOString()).toBe(start.toISOString());
    const end = endOfDayInTz(ref, TZ);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  describe('DST: Israel spring-forward (Fri before last Sunday of March, 02:00 -> 03:00)', () => {
    // In 2026 Israel DST begins Friday 2026-03-27 at 02:00 (clocks jump to 03:00).
    it('the spring-forward calendar day is 23 hours long', () => {
      const dayStart = startOfDayInTz(new Date('2026-03-27T12:00:00Z'), TZ);
      const nextDayStart = startOfDayInTz(new Date('2026-03-28T12:00:00Z'), TZ);
      const hours = (nextDayStart.getTime() - dayStart.getTime()) / 3_600_000;
      expect(hours).toBe(23);
    });

    it('addCalendarDaysInTz across the gap preserves local time-of-day', () => {
      // 2026-03-26 10:00 IST + 2 days = 2026-03-28 10:00 IDT (offset changed).
      const ref = new Date('2026-03-26T08:00:00Z');
      expect(local(ref, TZ)).toBe('2026-03-26, 10:00:00');
      const plus2 = addCalendarDaysInTz(ref, 2, TZ);
      expect(local(plus2, TZ)).toBe('2026-03-28, 10:00:00');
    });

    it('startOfDay on the spring-forward day lands on local 00:00', () => {
      const start = startOfDayInTz(new Date('2026-03-27T15:00:00Z'), TZ);
      expect(local(start, TZ)).toBe('2026-03-27, 00:00:00');
    });
  });

  describe('addCalendarDaysInTz general', () => {
    it('adds and subtracts whole calendar days within a stable offset', () => {
      const ref = new Date('2026-06-10T07:30:00Z'); // 10:30 IDT
      expect(local(addCalendarDaysInTz(ref, 7, TZ), TZ)).toBe('2026-06-17, 10:30:00');
      expect(local(addCalendarDaysInTz(ref, -7, TZ), TZ)).toBe('2026-06-03, 10:30:00');
    });

    it('rolls month/year boundaries correctly', () => {
      const ref = new Date('2026-12-31T20:00:00Z'); // 22:00 IST
      expect(local(addCalendarDaysInTz(ref, 1, TZ), TZ)).toBe('2027-01-01, 22:00:00');
    });
  });
});
