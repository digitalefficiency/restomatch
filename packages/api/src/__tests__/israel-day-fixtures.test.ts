import { describe, expect, it } from 'vitest';
import { israelMonth, israelToday } from './fixtures';

// The shared seed's Israel-day helpers (night-window fix, #227) on the days the
// offset changes: 27.03.2026 (spring forward 02:00 → 03:00, +02 → +03) and
// 25.10.2026 (fall back 02:00 → 01:00, +03 → +02), plus the month boundary.
describe('israelToday / israelMonth are correct across DST and month ends', () => {
  it.each([
    // [label, now (UTC), hour, expected UTC instant]
    ['spring-forward day, 00:00 (still +02)', '2026-03-27T10:00:00Z', 0, '2026-03-26T22:00:00.000Z'],
    ['spring-forward day, 03:00 (now +03)', '2026-03-27T10:00:00Z', 3, '2026-03-27T00:00:00.000Z'],
    ['spring-forward day, 11:00', '2026-03-27T10:00:00Z', 11, '2026-03-27T08:00:00.000Z'],
    ['fall-back day, 00:00 (still +03)', '2026-10-25T10:00:00Z', 0, '2026-10-24T21:00:00.000Z'],
    ['fall-back day, 11:00 (now +02)', '2026-10-25T10:00:00Z', 11, '2026-10-25T09:00:00.000Z'],
    ['fall-back day, 23:00 (+02)', '2026-10-25T10:00:00Z', 23, '2026-10-25T21:00:00.000Z'],
    ['the night window: 31.10 22:30Z is already 1.11 in Israel', '2026-10-31T22:30:00Z', 11, '2026-11-01T09:00:00.000Z'],
    ['an ordinary afternoon (UTC day = Israel day)', '2026-10-31T13:00:00Z', 10, '2026-10-31T08:00:00.000Z'],
  ])('%s', (_label, now, hour, expected) => {
    expect(israelToday(hour, new Date(now)).toISOString()).toBe(expected);
  });

  it('israelMonth flips with the Israel day, not the UTC one', () => {
    expect(israelMonth(new Date('2026-10-31T21:59:00Z'))).toBe('2026-10');
    expect(israelMonth(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11');
    expect(israelMonth(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01');
  });
});
