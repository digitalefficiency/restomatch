import { describe, expect, it } from 'vitest';
import { detectDecimalStyle, parseNumberInput } from '@restomatch/types';
import { parseScaled } from '../integrations/pos/csv';

/**
 * The shared number parser (@restomatch/types number-input): the POS CSV
 * importer's parseScaled grammar, generalised (scale, grouping, sign, the
 * file's decimal style). Price lists (W1-10), receiving (W1-09) and orders
 * (W1-11) import it — one grammar, so "0,250" can never mean 250 anywhere.
 */
const ok = (value: number, scaled: number) => ({ kind: 'ok', value, scaled });

describe('money (grouping on, scale 4, no sign)', () => {
  const money = (raw: string | null) => parseNumberInput(raw, { scale: 4 });
  it.each([
    ['1250', 1250],
    ['1,250', 1250],
    ['₪ 2,400', 2400],
    ['1,250,000', 1_250_000],
    ['1,250.00', 1250],
    ['12,90', 12.9],
    ['7,5', 7.5],
    ['0,250', 0.25], // never 250 (review finding 3)
    ['0,750', 0.75],
    ['0,125', 0.125],
    ['12.3456', 12.3456],
    ['1.234.567', 1_234_567],
    ['45 ש"ח', 45],
  ])('%s → %d', (raw, value) => {
    const cell = money(raw);
    expect(cell.kind).toBe('ok');
    expect(cell.kind === 'ok' && cell.value).toBe(value);
  });
  it('is exact in scaled units', () => {
    expect(money('12,90')).toEqual(ok(12.9, 129_000));
    expect(money('0,250')).toEqual(ok(0.25, 2_500));
  });
  it.each([
    '-5',
    '5-',
    '(5)',
    '1e3',
    'abc',
    '₪',
    '1,23456',
    '1,25,0',
    '0,250,000',
    '1.234,50',
    '0.123.456',
  ])('refuses %s', (raw) => expect(money(raw).kind).toBe('invalid'));
  it('empty is empty', () => {
    expect(money('  ')).toEqual({ kind: 'empty' });
    expect(money(null)).toEqual({ kind: 'empty' });
  });
});

describe("the file's decimal style", () => {
  it('a "1.250,00" file reads dot groups and a comma decimal', () => {
    expect(detectDecimalStyle(['12', '1.250,00'])).toBe('comma');
    expect(detectDecimalStyle(['1,250', '0,250'])).toBe('auto');
    const c = (raw: string) => parseNumberInput(raw, { decimal: 'comma' });
    expect(c('1.250,50')).toEqual(ok(1250.5, 12_505_000));
    expect(c('1.250')).toEqual(ok(1250, 12_500_000));
    expect(c('7,5')).toEqual(ok(7.5, 75_000));
    expect(c('0.125')).toEqual(ok(0.125, 1_250));
  });
});

describe('quantity (grouping off): "1,250" is ambiguous, never guessed', () => {
  const qty = (raw: string) => parseNumberInput(raw, { scale: 3, grouping: false });
  it('decimal commas and dots read; a thousands-looking value is refused', () => {
    expect(qty('12,5')).toEqual(ok(12.5, 12_500));
    expect(qty('0,500')).toEqual(ok(0.5, 500));
    expect(qty('2.75')).toEqual(ok(2.75, 2_750));
    expect(qty('1,250').kind).toBe('invalid');
    expect(qty('1.250.000').kind).toBe('invalid');
  });
});

describe('parity with parseScaled (the POS importer) at scale 2, signs allowed', () => {
  it.each([
    '1250',
    '1,250',
    '12,5',
    '0,500',
    '1,234.50',
    '-50',
    '50-',
    '(50)',
    '12.34',
    '12.345',
    '(-5)',
    'x',
    '1,2,3',
  ])('%s', (raw) => {
    const ours = parseNumberInput(raw, { scale: 2, negative: true });
    expect(ours.kind === 'ok' ? ours.scaled : null).toBe(parseScaled(raw, 2));
  });
  it('and for a comma-decimal value in a comma-decimal file', () => {
    const ours = parseNumberInput('1.234,50', { scale: 2, decimal: 'comma' });
    expect(ours.kind === 'ok' ? ours.scaled : null).toBe(parseScaled('1.234,50', 2));
  });
});
