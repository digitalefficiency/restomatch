import { describe, expect, it } from 'vitest';
import { localMonth, localYmd } from '../approvals/pay-run/dates';

describe('pay-run local dates (Asia/Jerusalem)', () => {
  it('the month start instant is the local month, not the UTC one', () => {
    expect(localMonth('2026-09-30T21:00:00Z')).toBe('2026-10'); // October, IDT (+3)
    expect(localMonth('2026-11-30T22:00:00Z')).toBe('2026-12'); // December, IST (+2)
  });
  it('an invoice late in the UTC day is the next local day', () => {
    expect(localYmd('2026-10-24T22:30:00Z')).toBe('2026-10-25');
    expect(localYmd('2026-10-24T08:00:00Z')).toBe('2026-10-24');
  });
});
