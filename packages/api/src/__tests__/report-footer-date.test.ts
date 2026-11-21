import { describe, expect, it } from 'vitest';
import { reportFooterDate } from '../reports/pdf';

/**
 * The monthly-report PDF footer is stamped with the restaurant's (Israeli)
 * calendar day of generation — never the UTC day, which is yesterday every
 * night between local midnight and 02:00 (03:00 in summer).
 */
describe('reportFooterDate — the Israeli day the report was generated', () => {
  it.each([
    ['2026-11-10T10:00:00.000Z', '2026-11-10'], // daytime: same day either way
    ['2026-11-07T22:30:00.000Z', '2026-11-08'], // 00:30 IST — the UTC day is still the 7th
    ['2026-11-30T22:30:00.000Z', '2026-12-01'], // 00:30 IST on the 1st — not "30 November"
    ['2026-12-31T22:30:00.000Z', '2027-01-01'], // year boundary
    ['2027-06-30T21:30:00.000Z', '2027-07-01'], // 00:30 IDT (summer, +3)
  ])('%s → %s', (generatedAt, day) => {
    expect(reportFooterDate(generatedAt)).toBe(day);
  });
});
