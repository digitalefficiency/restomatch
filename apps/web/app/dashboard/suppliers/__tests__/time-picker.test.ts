import { describe, expect, it } from 'vitest';
import { TIME_CHIPS, maskTime, parseTime } from '../time-logic';

describe('W2-11 · 24 h time picker', () => {
  it('chips run 06:00–14:00 every 30 minutes', () => {
    expect(TIME_CHIPS[0]).toBe('06:00');
    expect(TIME_CHIPS[TIME_CHIPS.length - 1]).toBe('14:00');
    expect(TIME_CHIPS).toHaveLength(17);
  });

  it.each([
    ['9', '9'],
    ['930', '9:30'],
    ['0930', '09:30'],
    ['17:45', '17:45'],
    ['123456', '12:34'],
  ])('masks %s → %s', (raw, out) => {
    expect(maskTime(raw)).toBe(out);
  });

  it.each([
    ['9:30', '09:30'],
    ['17:45', '17:45'],
    ['0000', '00:00'],
    ['24:00', null],
    ['12:60', null],
    ['9', null],
    ['', null],
  ])('parses %s → %s', (raw, out) => {
    expect(parseTime(raw)).toBe(out);
  });
});
