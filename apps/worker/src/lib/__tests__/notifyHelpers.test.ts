import { afterEach, describe, expect, it } from 'vitest';
import {
  appBaseUrl,
  formatIlsAmount,
  ilWeekday,
  ilWeekdayLabel,
  startOfIlDay,
} from '../notifyHelpers';

/**
 * First worker test (plan v2, T0): the Israel-time helpers every cadence job
 * depends on. Both DST regimes are covered — the known timezone bugs lived in
 * exactly this kind of offset math.
 */
describe('IL day + weekday helpers', () => {
  it('rolls the weekday over at Israel midnight in summer (UTC+3)', () => {
    // 2026-09-06 21:30Z = 2026-09-07 00:30 Asia/Jerusalem (Monday)
    expect(ilWeekday(new Date('2026-09-06T21:30:00Z'))).toBe(1);
    // 2026-09-06 20:30Z = 2026-09-06 23:30 Asia/Jerusalem (Sunday)
    expect(ilWeekday(new Date('2026-09-06T20:30:00Z'))).toBe(0);
  });

  it('rolls the weekday over at Israel midnight in winter (UTC+2)', () => {
    // 2026-01-10 22:30Z = 2026-01-11 00:30 Asia/Jerusalem (Sunday)
    expect(ilWeekday(new Date('2026-01-10T22:30:00Z'))).toBe(0);
    expect(ilWeekdayLabel(new Date('2026-01-10T22:30:00Z'))).toBe('יום ראשון');
    // Saturday label
    expect(ilWeekdayLabel(new Date('2026-01-10T10:00:00Z'))).toBe('שבת');
  });

  it('startOfIlDay returns the UTC instant of Israel midnight', () => {
    expect(startOfIlDay(new Date('2026-09-06T21:30:00Z')).toISOString()).toBe(
      '2026-09-06T21:00:00.000Z',
    );
    expect(startOfIlDay(new Date('2026-01-10T22:30:00Z')).toISOString()).toBe(
      '2026-01-10T22:00:00.000Z',
    );
  });
});

describe('email formatting helpers', () => {
  const saved = { APP_BASE_URL: process.env.APP_BASE_URL, AUTH_URL: process.env.AUTH_URL };
  afterEach(() => {
    process.env.APP_BASE_URL = saved.APP_BASE_URL;
    process.env.AUTH_URL = saved.AUTH_URL;
  });

  it('formats whole shekels with a ₪ sign and he-IL grouping', () => {
    const out = formatIlsAmount(1240);
    expect(out).toContain('1,240');
    expect(out).toContain('₪');
    expect(out).not.toContain('.00');
    expect(formatIlsAmount(12.5, 2)).toContain('12.50');
  });

  it('appBaseUrl prefers APP_BASE_URL, then AUTH_URL, and strips trailing slashes', () => {
    process.env.APP_BASE_URL = 'https://app.example.test///';
    expect(appBaseUrl()).toBe('https://app.example.test');
    delete process.env.APP_BASE_URL;
    process.env.AUTH_URL = 'https://auth.example.test/';
    expect(appBaseUrl()).toBe('https://auth.example.test');
  });
});
