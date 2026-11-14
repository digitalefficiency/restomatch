import { describe, expect, it } from 'vitest';
import { planUsageRows, trialDaysLeft, type PlanUsageInput } from '../planUsage';

const base: PlanUsageInput = {
  planKey: 'pro',
  status: 'active',
  trialEndsAt: null,
  limits: { invoicesPerMonth: 500, restaurants: 1, seatsPerRestaurant: 10 },
  scans: { metered: true, used: 120, limit: 500, withinLimit: true },
  restaurantsUsed: 1,
  seatsUsed: 3,
};

describe('planUsageRows', () => {
  it('passes the server numbers through and is neutral under 90%', () => {
    const [scans, , seats] = planUsageRows(base);
    expect(scans).toEqual({ key: 'scans', used: 120, limit: 500, pct: 24, tone: 'T4' });
    expect(seats!.tone).toBe('T4');
  });
  it('warns at ≥ 90% and when the quota blocks', () => {
    expect(planUsageRows({ ...base, scans: { ...base.scans, used: 450 } })[0]!.tone).toBe('T2');
    expect(planUsageRows({ ...base, scans: { metered: true, used: 3, limit: 0, withinLimit: false } })[0]!.tone).toBe('T2');
  });
  it('an implicit trial is unmetered: no limit, no percentage', () => {
    const r = planUsageRows({ ...base, scans: { metered: false, used: 0, limit: null, withinLimit: true } })[0]!;
    expect(r.limit).toBeNull();
    expect(r.pct).toBeNull();
    expect(r.tone).toBe('T4');
  });
  it('a full restaurant count is a warning, not hidden', () => {
    expect(planUsageRows(base)[1]!.tone).toBe('T2');
  });
});

describe('trialDaysLeft', () => {
  const now = new Date('2026-10-25T09:40:00Z');
  it('counts whole days up', () => {
    expect(trialDaysLeft({ status: 'trialing', trialEndsAt: '2026-10-27T00:00:00Z' }, now)).toBe(2);
  });
  it('null when not trialing; 0 when past', () => {
    expect(trialDaysLeft({ status: 'active', trialEndsAt: null }, now)).toBeNull();
    expect(trialDaysLeft({ status: 'trialing', trialEndsAt: '2026-10-01T00:00:00Z' }, now)).toBe(0);
  });
});
