import { describe, expect, it } from 'vitest';
import { demoNow } from '../../scripts/check-demo';

// check:demo / reseed:demo compute the hero AT DEMO_TODAY (12:00 Israel), not the
// real clock — a lab seeded for 25.10 checked in November read "hero 0.00%".
describe('demoNow (DEMO_TODAY → the instant the demo check computes at)', () => {
  it('25.10.2026 is the day IDT ends: 12:00 IL = 10:00Z (+02:00), not 09:00Z', () => {
    expect(demoNow('2026-10-25').toISOString()).toBe('2026-10-25T10:00:00.000Z');
  });

  it('summer (+03:00) and winter (+02:00) days', () => {
    expect(demoNow('2026-07-01').toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(demoNow('2026-12-01').toISOString()).toBe('2026-12-01T10:00:00.000Z');
  });

  it('the DST start day (27.03.2026, 02:00 → 03:00) is already +03:00 at noon', () => {
    expect(demoNow('2026-03-27').toISOString()).toBe('2026-03-27T09:00:00.000Z');
  });
});
