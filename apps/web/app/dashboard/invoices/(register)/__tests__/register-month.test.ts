import { describe, expect, it } from 'vitest';
import { pickRegisterMonth } from '../month';

/** 00:05 on 1.11.2026, Israel time (UTC+2 after the October clock change). */
const FIRST_0005 = new Date('2026-11-01T00:05:00+02:00');

describe('register month on the first days of a month', () => {
  it('at 00:05 on the 1st with an empty current month, opens the previous month and flags it', () => {
    expect(pickRegisterMonth({ param: undefined, now: FIRST_0005, currentMonthCount: 0 })).toEqual({ monthOffset: -1, fellBack: true });
  });
  it('the current month as soon as it has an invoice', () => {
    expect(pickRegisterMonth({ param: undefined, now: FIRST_0005, currentMonthCount: 1 })).toEqual({ monthOffset: 0, fellBack: false });
  });
  it('day 5 still falls back, day 6 does not (Israel time, not UTC)', () => {
    expect(pickRegisterMonth({ param: undefined, now: new Date('2026-11-05T23:30:00+02:00'), currentMonthCount: 0 }).fellBack).toBe(true);
    // 2026-11-05T22:30Z is already 6.11 00:30 in Israel.
    expect(pickRegisterMonth({ param: undefined, now: new Date('2026-11-05T22:30:00Z'), currentMonthCount: 0 })).toEqual({ monthOffset: 0, fellBack: false });
  });
  it('an explicit ?month= always wins (?month=0 = the current month, even when empty)', () => {
    expect(pickRegisterMonth({ param: '0', now: FIRST_0005, currentMonthCount: 0 })).toEqual({ monthOffset: 0, fellBack: false });
    expect(pickRegisterMonth({ param: '-3', now: FIRST_0005, currentMonthCount: 0 })).toEqual({ monthOffset: -3, fellBack: false });
    expect(pickRegisterMonth({ param: '7', now: FIRST_0005, currentMonthCount: 0 }).monthOffset).toBe(0);
  });
});
