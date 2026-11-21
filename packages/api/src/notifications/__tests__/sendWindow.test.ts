import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capKey,
  isExemptFromSendWindow,
  localDay,
  nextDayAllowedAt,
  resetSendWindowWarnings,
  shabbatWindow,
  staffAlertWindow,
} from '../sendWindow';

/**
 * Owner rules for staff alerts: nothing 23:00–06:00, nothing on Shabbat
 * (Fri 15:00 → Sat 19:00 Israel time by default). November 2026 is IST
 * (UTC+2); 2026-10-25 and 2027-03-26 are the DST changes.
 */
const at = (iso: string) => new Date(iso);
const decide = (iso: string) => staffAlertWindow(at(iso), shabbatWindow(undefined));

describe('staffAlertWindow — Shabbat', () => {
  it('Fri 14:59 sends', () => {
    expect(decide('2026-11-06T12:59:00Z')).toEqual({ open: true });
  });

  it('Fri 15:01 defers to Sat 19:00', () => {
    expect(decide('2026-11-06T13:01:00Z')).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2026-11-07T17:00:00Z') });
  });

  it('Fri 23:30 is Shabbat, not quiet hours: it waits for Sat 19:00, not 06:00', () => {
    expect(decide('2026-11-06T21:30:00Z')).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2026-11-07T17:00:00Z') });
  });

  it('Sat 18:59 defers; Sat 19:00 sends', () => {
    expect(decide('2026-11-07T16:59:00Z')).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2026-11-07T17:00:00Z') });
    expect(decide('2026-11-07T17:00:00Z')).toEqual({ open: true });
  });
});

describe('staffAlertWindow — quiet hours', () => {
  it('23:30 defers to 06:00 the next morning', () => {
    expect(decide('2026-11-03T21:30:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2026-11-04T04:00:00Z') });
  });

  it('05:59 defers to 06:00; 06:00 and 22:59 send', () => {
    expect(decide('2026-11-04T03:59:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2026-11-04T04:00:00Z') });
    expect(decide('2026-11-04T04:00:00Z')).toEqual({ open: true });
    expect(decide('2026-11-04T20:59:00Z')).toEqual({ open: true });
  });

  it('Sat 23:30 (after Shabbat) waits for Sun 06:00', () => {
    expect(decide('2026-11-07T21:30:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2026-11-08T04:00:00Z') });
  });
});

describe('staffAlertWindow — DST edges', () => {
  it('2026-10-25 (IDT → IST): Sat 23:30 IDT waits for Sun 06:00 IST', () => {
    // 23:30 IDT = 20:30Z; 06:00 IST = 04:00Z (6.5 wall hours, 7.5 real ones).
    expect(decide('2026-10-24T20:30:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2026-10-25T04:00:00Z') });
    // Shabbat that week still ends at 19:00 IDT.
    expect(decide('2026-10-24T15:59:00Z')).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2026-10-24T16:00:00Z') });
    // 01:30 on the change night is quiet (either 01:30) and opens at 06:00 IST.
    expect(decide('2026-10-24T23:30:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2026-10-25T04:00:00Z') });
  });

  it('2027-03-26 (IST → IDT, a Friday): Thu 23:30 IST opens Fri 06:00 IDT; Shabbat starts 15:00 IDT', () => {
    expect(decide('2027-03-25T21:30:00Z')).toEqual({ open: false, reason: 'quiet', nextAllowedAt: at('2027-03-26T03:00:00Z') });
    expect(decide('2027-03-26T11:59:00Z')).toEqual({ open: true }); // Fri 14:59 IDT
    expect(decide('2027-03-26T12:01:00Z')).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2027-03-27T16:00:00Z') });
  });
});

describe('NOTIFY_SHABBAT_WINDOW', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetSendWindowWarnings();
  });

  it('an override moves the window', () => {
    const w = shabbatWindow('FRI16:00-SAT20:00');
    expect(staffAlertWindow(at('2026-11-06T13:30:00Z'), w)).toEqual({ open: true }); // Fri 15:30
    expect(staffAlertWindow(at('2026-11-07T17:30:00Z'), w)).toEqual({ open: false, reason: 'shabbat', nextAllowedAt: at('2026-11-07T18:00:00Z') });
  });

  it('a malformed value falls back to the default with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const _ of [1, 2, 3]) expect(shabbatWindow('Friday 3pm')).toEqual(shabbatWindow(undefined));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(staffAlertWindow(at('2026-11-06T13:01:00Z'), shabbatWindow('FRI25:00-SAT19:00'))).toMatchObject({ open: false, reason: 'shabbat' });
  });
});

describe('the daily cap helpers', () => {
  it('the next day 06:00, pushed past Shabbat', () => {
    const w = shabbatWindow(undefined);
    expect(nextDayAllowedAt(at('2026-11-05T08:00:00Z'), w)).toEqual(at('2026-11-06T04:00:00Z')); // Thu → Fri 06:00
    expect(nextDayAllowedAt(at('2026-11-06T08:00:00Z'), w)).toEqual(at('2026-11-07T17:00:00Z')); // Fri → Sat 19:00
  });

  it('the local day, also on the DST-change day (25 hours long)', () => {
    expect(localDay(at('2026-10-24T21:30:00Z'))).toEqual({
      key: '2026-10-25',
      start: at('2026-10-24T21:00:00Z'),
      end: at('2026-10-25T22:00:00Z'),
    });
  });

  it('a real address is one person across restaurants; a role target is per restaurant', () => {
    expect(capKey({ restaurantId: 'r1', target: 'Dana@Example.com' })).toBe('dana@example.com');
    expect(capKey({ restaurantId: 'r1', target: 'role:manager' })).toBe('r1:role:manager');
  });
});

describe('exempt kinds', () => {
  it('a PO send is exempt; the supplier-delay alert on the same PO is not', () => {
    expect(isExemptFromSendWindow({ relatedEntityType: 'purchase_order', dedupeKey: 'po:abc:placed' })).toBe(true);
    expect(isExemptFromSendWindow({ relatedEntityType: 'purchase_order', dedupeKey: 'po:abc:delay:2026-11-06:m@x.co' })).toBe(false);
    expect(isExemptFromSendWindow({ relatedEntityType: 'match_run', dedupeKey: null })).toBe(false);
    expect(isExemptFromSendWindow({ relatedEntityType: 'restaurant', dedupeKey: 'eod-report:r:2026-11-06:m@x.co' })).toBe(false);
  });
});
