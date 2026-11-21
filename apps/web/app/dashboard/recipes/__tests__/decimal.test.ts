import { describe, expect, it } from 'vitest';
import { parseDecimalInput } from '../decimal';

describe('parseDecimalInput (W3-02 interim for G-13)', () => {
  it('qty: dot or comma decimals, canonical text for the API', () => {
    expect(parseDecimalInput('1,5', 'qty')).toMatchObject({ kind: 'ok', value: 1.5, text: '1.5' });
    expect(parseDecimalInput('200', 'qty')).toMatchObject({ kind: 'ok', text: '200' });
    expect(parseDecimalInput('0,250', 'qty')).toMatchObject({ kind: 'ok', text: '0.25' });
    expect(parseDecimalInput('12.3456', 'qty')).toMatchObject({ kind: 'ok', text: '12.3456' });
  });
  it('qty: "1,250" is ambiguous, never guessed; junk and too many decimals are invalid', () => {
    expect(parseDecimalInput('1,250', 'qty').kind).toBe('ambiguous');
    expect(parseDecimalInput('abc', 'qty').kind).toBe('invalid');
    expect(parseDecimalInput('1.23456', 'qty').kind).toBe('invalid');
    expect(parseDecimalInput('-2', 'qty').kind).toBe('invalid');
    expect(parseDecimalInput('  ', 'qty').kind).toBe('empty');
  });
  it('ils: agorot, grouping and a decimal comma, ₪ ignored', () => {
    expect(parseDecimalInput('68,50', 'ils')).toMatchObject({ kind: 'ok', agorot: 6850 });
    expect(parseDecimalInput('₪ 69', 'ils')).toMatchObject({ kind: 'ok', agorot: 6900 });
    expect(parseDecimalInput('1,250', 'ils')).toMatchObject({ kind: 'ok', agorot: 125_000 });
    expect(parseDecimalInput('12.345', 'ils').kind).not.toBe('ok');
  });
});
