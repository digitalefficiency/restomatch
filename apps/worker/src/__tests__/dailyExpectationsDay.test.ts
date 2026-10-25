import { describe, expect, it } from 'vitest';
import { ilDayWindow } from '../jobs/dailyExpectations';

/**
 * daily-expectations runs at 06:00 Israel time — on the owner's Mac (IL) or in
 * the web app's serverless runner (UTC). Its "today" must be the Israel day on
 * both: never the host's local midnight.
 */
describe('ilDayWindow', () => {
  it('a winter day: 00:00–23:59:59.999 Israel time (UTC+2)', () => {
    const w = ilDayWindow(new Date('2026-11-10T04:00:30Z')); // 06:00:30 IL
    expect(w).toEqual({
      startOfDay: new Date('2026-11-09T22:00:00.000Z'),
      endOfDay: new Date('2026-11-10T21:59:59.999Z'),
      date: '2026-11-10',
    });
  });

  it('the DST change day (2026-10-25, 25 h long) is still one Israel day', () => {
    const w = ilDayWindow(new Date('2026-10-25T04:00:30Z')); // 06:00:30 IL (UTC+2 after 02:00)
    expect(w.date).toBe('2026-10-25');
    expect(w.startOfDay.toISOString()).toBe('2026-10-24T21:00:00.000Z'); // midnight IDT (UTC+3)
    expect(w.endOfDay.toISOString()).toBe('2026-10-25T21:59:59.999Z'); // 23:59:59.999 IST
  });

  it('just after Israel midnight is the new Israel day, though UTC is still on the old one', () => {
    expect(ilDayWindow(new Date('2026-11-09T22:30:00Z')).date).toBe('2026-11-10');
  });
});
