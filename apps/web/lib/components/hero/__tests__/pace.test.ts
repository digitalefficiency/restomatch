import { describe, expect, it } from 'vitest';
import { motion } from '@restomatch/ui-tokens';
import { PACE_BOX, paceGeometry } from '../../data-viz';
import { bucketDayIndex, cubicBezier, msOf, paceSeries, parseCubicBezier, todayDayIndex, type PacePoint } from '../model';

/**
 * The UTC instant of an Israel local midnight in 2026: summer time (+03:00) from 27.3 02:00 to
 * 25.10 02:00, otherwise +02:00. owner.leakTrend's day buckets are exactly these instants.
 */
function ilMidnight(month: number, day: number): string {
  const summer = (month > 3 && month < 10) || (month === 3 && day >= 28) || (month === 10 && day <= 25);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return new Date(`2026-${mm}-${dd}T00:00:00${summer ? '+03:00' : '+02:00'}`).toISOString();
}
const ilWall = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const pt = (month: number, day: number, leakIls: number): PacePoint => ({ bucketStart: ilMidnight(month, day), leakIls });

const NOV = ilMidnight(11, 1);
const OCT = ilMidnight(10, 1);
const MAR = ilMidnight(3, 1);

describe('the fixtures are Israel midnights (the clock changes of 2026 included)', () => {
  it('1.11 local is 31.10 22:00Z; 1.10 is 30.9 21:00Z; 1.3 is 28.2 22:00Z', () => {
    expect(NOV).toBe('2026-10-31T22:00:00.000Z');
    expect(OCT).toBe('2026-09-30T21:00:00.000Z');
    expect(MAR).toBe('2026-02-28T22:00:00.000Z');
  });
  it('every bucket of October and March is 00:00 on its own day', () => {
    for (const [month, days] of [[10, 31], [3, 31], [11, 30]] as const) {
      for (let d = 1; d <= days; d++) expect(ilWall(ilMidnight(month, d)), `${d}.${month}`).toBe(`${d}, 00:00`);
    }
  });
});

describe('bucketDayIndex — local midnights by whole days, across a clock change (v2 D2)', () => {
  it('every day of October 2026 (summer time ends on 25.10) is its own day of the month', () => {
    for (let d = 1; d <= 31; d++) expect(bucketDayIndex(ilMidnight(10, d), OCT), `${d}.10`).toBe(d);
  });
  it('every day of March 2026 (summer time starts on 27.3) is its own day of the month', () => {
    for (let d = 1; d <= 31; d++) expect(bucketDayIndex(ilMidnight(3, d), MAR), `${d}.3`).toBe(d);
  });
  it('needs no time zone: London midnights around its own change (25.10 01:00Z) index the same way', () => {
    const start = '2026-09-30T23:00:00.000Z'; // 1.10 00:00 BST
    expect(bucketDayIndex('2026-10-24T23:00:00.000Z', start)).toBe(25); // 25.10 00:00 BST
    expect(bucketDayIndex('2026-10-26T00:00:00.000Z', start)).toBe(26); // 26.10 00:00 GMT
  });
});

describe('todayDayIndex — the Israel wall clock; a clock change never shifts the day (v2 D3)', () => {
  it('noon, just after and just before a local midnight', () => {
    expect(todayDayIndex('2026-11-21T10:00:00Z', NOV)).toBe(21);
    expect(todayDayIndex('2026-11-20T22:30:00Z', NOV)).toBe(21); // 00:30 on 21.11
    expect(todayDayIndex('2026-11-21T21:30:00Z', NOV)).toBe(21); // 23:30 on 21.11
    expect(todayDayIndex(new Date('2026-11-01T00:00:00+02:00'), NOV)).toBe(1);
  });
  it('after the clocks go back (October): 23:30 on 28.10 is still day 28', () => {
    // The naive (now − monthStart) / 24 h reads 28 days and 30 minutes here: day 29.
    expect(todayDayIndex('2026-10-28T21:30:00Z', OCT)).toBe(28);
    expect(todayDayIndex('2026-10-28T22:30:00Z', OCT)).toBe(29); // 00:30 on 29.10
  });
  it('after the clocks go forward (March): 00:30 on 28.3 is already day 28', () => {
    // The naive count reads 26 days and 23.5 hours here: day 27.
    expect(todayDayIndex('2026-03-27T21:30:00Z', MAR)).toBe(28);
    expect(todayDayIndex('2026-03-27T20:30:00Z', MAR)).toBe(27); // 23:30 on 27.3
  });
  it('the night of the change itself: both 01:30s of 25.10 are day 25', () => {
    expect(todayDayIndex('2026-10-24T22:30:00Z', OCT)).toBe(25); // 01:30 summer time
    expect(todayDayIndex('2026-10-24T23:30:00Z', OCT)).toBe(25); // 01:30 again, winter time
  });
  it('an instant that does not parse is no day', () => expect(todayDayIndex('not a date', NOV)).toBe(0));
});

describe('paceSeries — integer agorot running totals that end on the hero (v2 D1–D4)', () => {
  // The lab month (21.11): sparse days, Σ = ₪769.77 = the hero; the same days of October Σ ₪617.89.
  const cur = [pt(11, 1, 0), pt(11, 2, 131.32), pt(11, 3, 92.64), pt(11, 5, 100), pt(11, 9, 208.66), pt(11, 12, 72), pt(11, 16, 152.49), pt(11, 19, 12.66), pt(11, 20, 0)];
  const prevPoints = [pt(10, 1, 0), pt(10, 4, 70), pt(10, 10, 437.37), pt(10, 15, 110.52)];
  const current = { monthStart: NOV, leakIls: 769.77 };
  const previous = { monthStart: OCT, leakIls: 617.89, matchedInvoiceCount: 30, points: prevPoints };

  it('fills the days without invoices up to today and ends on the hero, to the agora', () => {
    const s = paceSeries({ bucket: 'day', points: cur, current, today: 21, previous })!;
    expect(s.cur).toHaveLength(21);
    expect(s.cur[0]).toBe(0);
    expect(s.cur[1]).toBe(13132);
    expect(s.cur[3]).toBe(22396); // day 4 holds day 3's total
    expect(s.cur[20]).toBe(76977);
  });

  it('is exactly the shared PaceSeries shape, and the shared geometry draws it', () => {
    const s = paceSeries({ bucket: 'day', points: cur, current, today: 21, previous })!;
    expect(Object.keys(s).sort()).toEqual(['cur', 'prev']);
    const g = paceGeometry(s);
    expect(g.end.x).toBe(PACE_BOX.width);
    expect(g.prev).not.toBeNull();
  });

  it('lines last month up by ITS day of the month and ends on leakSummary previous', () => {
    const s = paceSeries({ points: cur, current, today: 21, previous })!;
    expect(s.prev).toHaveLength(21);
    expect(s.prev![2]).toBe(0);
    expect(s.prev![3]).toBe(7000);
    expect(s.prev![20]).toBe(61789);
  });

  it('counts an invoice dated later this month on today, so the line still ends on the hero (D3)', () => {
    const s = paceSeries({ points: [pt(11, 1, 5), pt(11, 25, 5)], current: { monthStart: NOV, leakIls: 10 }, today: 21 })!;
    expect(s.cur).toHaveLength(21);
    expect(s.cur[19]).toBe(500);
    expect(s.cur[20]).toBe(1000);
  });

  it('draws nothing when the line does not end on the hero (never imply another figure)', () => {
    expect(paceSeries({ points: cur, current: { monthStart: NOV, leakIls: 769.78 }, today: 21, previous })).toBeNull();
    expect(paceSeries({ points: [], current, today: 21 })).toBeNull();
    expect(paceSeries({ points: null, current, today: 21 })).toBeNull();
  });

  it('draws nothing before day 2, for month buckets, or when a point falls before the month', () => {
    expect(paceSeries({ points: [pt(11, 1, 10)], current: { monthStart: NOV, leakIls: 10 }, today: 1 })).toBeNull();
    expect(paceSeries({ bucket: 'month', points: cur, current, today: 21 })).toBeNull();
    expect(paceSeries({ points: [pt(10, 30, 1), ...cur], current: { monthStart: NOV, leakIls: 770.77 }, today: 21 })).toBeNull();
    expect(paceSeries({ points: [{ bucketStart: 'not a date', leakIls: 0 }, ...cur], current, today: 21 })).toBeNull();
  });

  it('a flat month is a line on ₪0 (checked invoices, no leak)', () => {
    const s = paceSeries({ points: [pt(11, 3, 0)], current: { monthStart: NOV, leakIls: 0 }, today: 4 })!;
    expect(s.cur).toEqual([0, 0, 0, 0]);
  });

  it('never accumulates in floats (0.1 + 0.2)', () => {
    const s = paceSeries({ points: [pt(11, 1, 0.1), pt(11, 2, 0.2)], current: { monthStart: NOV, leakIls: 0.3 }, today: 2 })!;
    expect(s.cur).toEqual([10, 30]);
    expect(s.prev).toBeNull();
  });

  describe('the dashed line only when last month is known (D4)', () => {
    it('no days at all: [] is never drawn as zeros', () => {
      expect(paceSeries({ points: cur, current, today: 21, previous: { ...previous, points: [] } })!.prev).toBeNull();
      expect(paceSeries({ points: cur, current, today: 21, previous: { ...previous, points: null } })!.prev).toBeNull();
      expect(paceSeries({ points: cur, current, today: 21, previous: null })!.prev).toBeNull();
    });
    it('no checked invoices last month', () => {
      expect(paceSeries({ points: cur, current, today: 21, previous: { ...previous, matchedInvoiceCount: 0 } })!.prev).toBeNull();
    });
    it('a line that does not end on leakSummary previous', () => {
      expect(paceSeries({ points: cur, current, today: 21, previous: { ...previous, leakIls: 617.0 } })!.prev).toBeNull();
    });
  });

  it('a clock change inside either month moves no day: October as last month, after its change (27.11)', () => {
    const late = [...prevPoints, pt(10, 26, 20)]; // 26.10 00:00 is winter time, 25.10 22:00Z
    const s = paceSeries({ points: cur, current, today: 27, previous: { ...previous, leakIls: 637.89, points: late } })!;
    expect(s.prev![24]).toBe(61789); // day 25
    expect(s.prev![25]).toBe(63789); // day 26
  });

  it('a clock change inside either month moves no day: October as this month', () => {
    const points = [pt(10, 24, 10), pt(10, 26, 5)];
    const today = todayDayIndex('2026-10-28T21:30:00Z', OCT); // 23:30 on 28.10
    const s = paceSeries({ points, current: { monthStart: OCT, leakIls: 15 }, today })!;
    expect(s.cur).toHaveLength(28);
    expect(s.cur[22]).toBe(0);
    expect(s.cur[23]).toBe(1000);
    expect(s.cur[24]).toBe(1000);
    expect(s.cur[25]).toBe(1500);
    expect(s.cur[27]).toBe(1500);
  });
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
