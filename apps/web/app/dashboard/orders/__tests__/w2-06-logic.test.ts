import { describe, expect, it } from 'vitest';
import { addOrMerge } from '../order-logic';
import {
  countdown,
  cutoffTone,
  dayGroupOf,
  fillLikeLastTime,
  groupByDay,
  guideQtyOf,
  setGuideQty,
  sumVisibleAgorot,
  type GuideItem,
  type GuideLine,
} from '../w2-logic';

const NOW = new Date('2026-10-25T09:00:00Z'); // 11:00 in Jerusalem (DST ended that night: +2)
const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe('cut-off chips (W2-06 §5.2)', () => {
  it('warn ≤ 3 h, danger ≤ 30 min, closed once passed, neutral otherwise', () => {
    expect(cutoffTone(inMin(181), NOW)).toBe('neutral');
    expect(cutoffTone(inMin(180), NOW)).toBe('warn');
    expect(cutoffTone(inMin(31), NOW)).toBe('warn');
    expect(cutoffTone(inMin(30), NOW)).toBe('danger');
    expect(cutoffTone(inMin(0), NOW)).toBe('danger');
    expect(cutoffTone(inMin(-1), NOW)).toBe('closed');
    expect(cutoffTone(null, NOW)).toBeNull();
  });
  it('countdown "H:MM"', () => {
    expect(countdown(inMin(135), NOW)).toBe('2:15');
    expect(countdown(inMin(5), NOW)).toBe('0:05');
    expect(countdown(inMin(-5), NOW)).toBe('0:00');
  });
});

describe('day groups (phone list)', () => {
  it('today / tomorrow / week / later / past, restaurant-local', () => {
    expect(dayGroupOf('2026-10-25T20:00:00Z', NOW)).toBe('today'); // 22:00 local
    expect(dayGroupOf('2026-10-25T22:30:00Z', NOW)).toBe('tomorrow'); // 00:30 local next day (IST, +2 after 25.10)
    expect(dayGroupOf('2026-10-29T10:00:00Z', NOW)).toBe('week');
    expect(dayGroupOf('2026-11-05T10:00:00Z', NOW)).toBe('later');
    expect(dayGroupOf('2026-10-24T10:00:00Z', NOW)).toBe('past');
    expect(dayGroupOf(null, NOW)).toBe('later');
  });
  it('groups keep the fixed order and every row', () => {
    const rows = [{ at: '2026-11-05T10:00:00Z' }, { at: '2026-10-25T10:00:00Z' }, { at: '2026-10-26T10:00:00Z' }];
    const g = groupByDay(rows, (r) => r.at, NOW);
    expect(g.map((x) => x.group)).toEqual(['today', 'tomorrow', 'later']);
    expect(g.flatMap((x) => x.rows)).toHaveLength(3);
  });
});

describe('Σ = the visible rows', () => {
  it('sums in agorot and skips unknown totals (never ₪0)', () => {
    expect(sumVisibleAgorot([{ totalEstimated: '10.10' }, { totalEstimated: '0.20' }, { totalEstimated: null }, {}])).toEqual({
      agorot: 1030,
      counted: 2,
    });
  });
});

describe('order guide fill and undo (no invented qty)', () => {
  let n = 0;
  const key = () => `k${++n}`;
  const tomato: GuideItem = { key: 'p1', productId: 'p1', name: 'עגבניה', nameEn: null, unit: 'kg', usualQty: 5, lastQty: 6, unitPrice: 8 };
  const onion: GuideItem = { key: 'p2', productId: 'p2', name: 'בצל', nameEn: null, unit: 'kg', usualQty: 2, lastQty: 3 };

  it('the ghost tap sets the usual qty; 0 removes; nothing starts at 1', () => {
    let lines: GuideLine[] = [];
    expect(guideQtyOf(lines, tomato)).toBe(0);
    lines = setGuideQty(lines, tomato, tomato.usualQty, key);
    expect(lines).toMatchObject([{ productId: 'p1', qty: 5, unitPriceExpected: 8 }]);
    lines = setGuideQty(lines, tomato, 7, key);
    expect(lines).toHaveLength(1);
    expect(guideQtyOf(lines, tomato)).toBe(7);
    lines = setGuideQty(lines, tomato, 0, key);
    expect(lines).toEqual([]);
  });

  it('"כמו בפעם הקודמת" fills last qty, keeps what the user set, and undoes to the snapshot', () => {
    const before = setGuideQty<GuideLine>([], onion, 9, key);
    const r = fillLikeLastTime(before, [tomato, onion], key);
    expect(r.filled).toBe(1);
    expect(guideQtyOf(r.lines, tomato)).toBe(6);
    expect(guideQtyOf(r.lines, onion)).toBe(9);
    expect(r.undo).toBe(before);
  });

  it('adding the same catalog item with an empty qty never adds 1', () => {
    const l0 = addOrMerge<GuideLine>([], { productId: 'p1', rawDescription: 'עגבניה', qty: 0, unit: 'kg' }, key);
    const l1 = addOrMerge(l0.lines, { productId: 'p1', rawDescription: 'עגבניה', qty: 0, unit: 'kg' }, key);
    expect(l1.merged).toBe(true);
    expect(l1.lines[0]!.qty).toBe(0);
  });
});
