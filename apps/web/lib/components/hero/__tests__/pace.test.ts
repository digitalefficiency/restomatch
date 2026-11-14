import { describe, expect, it } from 'vitest';
import { motion } from '@restomatch/ui-tokens';
import { PACE_BOX, cubicBezier, israelDayOfMonth, msOf, paceGeometry, pacePath, paceSeries, parseCubicBezier } from '../model';

/** `owner.leakTrend` day buckets: the UTC instant of an Israel midnight (UTC+2 in November). */
const day = (d: number, leakIls: number, month = '11') => ({
  bucketStart: new Date(`2026-${month}-${String(d).padStart(2, '0')}T00:00:00+02:00`).toISOString(),
  leakIls,
});

describe('israelDayOfMonth — the Israel wall clock, never the UTC date', () => {
  it('a bucket at 22:00Z on 31.10 is 1 November in Israel', () => expect(israelDayOfMonth('2026-10-31T22:00:00.000Z')).toBe(1));
  it('noon in Israel', () => expect(israelDayOfMonth('2026-11-14T10:00:00Z')).toBe(14));
});

describe('paceSeries — running totals in integer agorot', () => {
  // The lab month (14.11): sparse days, Σ = ₪532.62 (the hero).
  const cur = [day(1, 0), day(2, 131.32), day(3, 92.64), day(5, 100), day(9, 208.66), day(13, 0)];
  const prev = [day(1, 0, '10'), day(4, 70, '10'), day(10, 437.37, '10')];

  it('fills the days without invoices and ends at the hero to the agora', () => {
    const s = paceSeries(cur, prev, '2026-11-14T10:00:00Z')!;
    expect(s.days).toBe(14);
    expect(s.cur).toHaveLength(14);
    expect(s.cur[0]).toBe(0);
    expect(s.cur[1]).toBe(13132);
    expect(s.cur[3]).toBe(22396); // day 4 holds day 3's total
    expect(s.cur[13]).toBe(53262);
  });

  it('lines the previous window up by day of month', () => {
    const s = paceSeries(cur, prev, '2026-11-14T10:00:00Z')!;
    expect(s.prev).not.toBeNull();
    expect(s.prev![2]).toBe(0);
    expect(s.prev![3]).toBe(7000);
    expect(s.prev![13]).toBe(50737);
  });

  it('never accumulates in floats (0.1 + 0.2)', () => {
    const s = paceSeries([day(1, 0.1), day(2, 0.2)], null, '2026-11-02T10:00:00Z')!;
    expect(s.cur).toEqual([10, 30]);
    expect(s.prev).toBeNull();
  });

  it('extends the axis to an invoice dated later this month', () => {
    const s = paceSeries([day(1, 5), day(20, 5)], null, '2026-11-14T10:00:00Z')!;
    expect(s.days).toBe(20);
    expect(s.cur[19]).toBe(1000);
  });

  it('no pace on the first day of the month', () => expect(paceSeries([day(1, 10)], null, '2026-11-01T10:00:00Z')).toBeNull());
});

describe('pacePath / paceGeometry — the reference box, step after', () => {
  it('starts on the baseline and steps up', () => {
    expect(pacePath([0, 50, 50, 100], 100)).toBe('M0,64 V64 H80 V33 H160 V33 H240 V2');
  });
  it('both series share one scale; the end dot sits on today', () => {
    const g = paceGeometry({ days: 3, cur: [0, 100, 200], prev: [0, 300, 400] });
    expect(g.prev).toBe('M0,64 V64 H120 V17.5 H240 V2');
    expect(g.end).toEqual({ x: PACE_BOX.width, y: 33 });
  });
  it('a flat month stays on the baseline', () => expect(paceGeometry({ days: 2, cur: [0, 0], prev: null }).cur).toBe('M0,64 V64 H240 V64'));
});

describe('motion helpers read the tokens, never a literal', () => {
  it('durations', () => {
    expect(msOf(motion.duration.long)).toBe(400);
    expect(msOf('0.24s')).toBe(240);
  });
  it('easings parse and run from 0 to 1 without overshoot', () => {
    const enter = parseCubicBezier(motion.easing.enter)!;
    expect(enter).toEqual([0, 0, 0.38, 0.9]);
    const ease = cubicBezier(...enter);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 20; i++) {
      const v = ease(i / 20);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
  });
  it('an unknown token is not guessed', () => expect(parseCubicBezier('ease-in')).toBeNull());
});
