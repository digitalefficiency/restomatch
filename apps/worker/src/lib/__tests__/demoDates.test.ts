import { describe, expect, it } from 'vitest';
import { demoContractFrom, demoTodayYmd, ymdMinusDays } from '../demoDates';

describe('demo date anchors', () => {
  it('derives the contract start from DEMO_TODAY (the date the contracts step was designed on)', () => {
    expect(demoContractFrom({ DEMO_TODAY: '2026-10-18' })).toBe('2026-10-10');
  });

  it('moves with DEMO_TODAY instead of staying pinned (the 2026-10-20+ regression)', () => {
    expect(demoContractFrom({ DEMO_TODAY: '2026-10-25' })).toBe('2026-10-17');
    expect(demoContractFrom({ DEMO_TODAY: '2026-11-03' })).toBe('2026-10-26');
    expect(demoContractFrom({ DEMO_TODAY: '2027-01-05' })).toBe('2026-12-28');
  });

  it('falls back to today on the Israeli wall clock', () => {
    // 2026-10-24 22:30 UTC is already 2026-10-25 in Asia/Jerusalem (UTC+2/3).
    expect(demoTodayYmd({}, new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    expect(demoContractFrom({}, new Date('2026-10-24T09:00:00Z'))).toBe('2026-10-16');
  });

  it('rejects a malformed DEMO_TODAY', () => {
    expect(() => demoTodayYmd({ DEMO_TODAY: '25/10/2026' })).toThrow(/YYYY-MM-DD/);
  });

  it('does calendar arithmetic across month/leap boundaries', () => {
    expect(ymdMinusDays('2028-03-01', 1)).toBe('2028-02-29');
    expect(ymdMinusDays('2026-01-03', 8)).toBe('2025-12-26');
  });
});
