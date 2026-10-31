import { describe, expect, it } from 'vitest';
import { todayCutoffs } from '../cutoffs';

// Sunday 25.10.2026, 10:00 in Israel (UTC+2 after the clocks went back).
const NOW = new Date('2026-10-25T08:00:00.000Z');

describe('todayCutoffs', () => {
  it('lists suppliers whose order window closes later today, soonest first', () => {
    const out = todayCutoffs(
      [
        { id: 'a', name: 'ירקות השרון', orderSchedule: { windows: [{ orderDays: [0, 2, 4], cutoff: '14:00' }] } },
        { id: 'b', name: 'קצביית הכרם', orderSchedule: { windows: [{ orderDays: [0], cutoff: '12:15' }] } },
        { id: 'c', name: 'מחלבות הגליל', orderSchedule: { windows: [{ orderDays: [1, 3], cutoff: '12:00' }] } },
      ],
      NOW,
    );
    expect(out.map((c) => [c.supplierId, c.cutoff, c.minutesLeft])).toEqual([
      ['b', '12:15', 135],
      ['a', '14:00', 240],
    ]);
  });

  it('a cutoff already past today, no schedule, or no window today is not listed', () => {
    expect(
      todayCutoffs(
        [
          { id: 'past', name: 'x', orderSchedule: { windows: [{ orderDays: [0], cutoff: '09:30' }] } },
          { id: 'none', name: 'y', orderSchedule: null },
          { id: 'empty', name: 'z' },
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it('several windows: the next one still open today wins', () => {
    const [c] = todayCutoffs([{ id: 'a', name: 'x', orderSchedule: { windows: [{ orderDays: [0], cutoff: '09:00' }, { orderDays: [0], cutoff: '18:30' }, { orderDays: [0], cutoff: '16:00' }] } }], NOW);
    expect(c).toMatchObject({ cutoff: '16:00', minutesLeft: 360 });
  });
});
