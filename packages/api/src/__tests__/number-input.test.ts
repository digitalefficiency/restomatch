import { describe, expect, it } from 'vitest';
import {
  detectDecimalStyle,
  moneyText,
  parseDecimalInput,
  parseNumberInput,
  type DecimalInputOptions,
  type DecimalKind,
} from '@restomatch/types';
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

/* ---------------------------------------------------------------------- *
 * G-13 · parseDecimalInput: the one input parser (DEEP-FIX class 12).
 * ---------------------------------------------------------------------- */
describe('parseDecimalInput: the DEEP-FIX input table', () => {
  const okField = (kind: DecimalKind, raw: string, opts?: DecimalInputOptions) => {
    const r = parseDecimalInput(raw, kind, opts);
    if (r.kind !== 'ok') return r.kind === 'empty' ? 'empty' : `${r.kind}:${r.reason}`;
    return (r as unknown as Record<string, number>)[FIELD_OF[kind]];
  };
  const FIELD_OF = { ils: 'agorot', unitPrice: 'priceUnits', qty: 'milli', percent: 'basisPoints' } as const;

  it.each<[string, DecimalKind, number | string]>([
    ['1,250', 'ils', 125_000],
    ['1,250', 'unitPrice', 12_500_000],
    ['1,250', 'qty', 'ambiguous:thousands-or-decimal-comma'],
    ['1,250', 'percent', 'ambiguous:thousands-or-decimal-comma'],
    ['₪1,250', 'ils', 125_000],
    ['₪ 2,400', 'ils', 240_000],
    ['1,250,000', 'ils', 125_000_000],
    ['12,90', 'ils', 1290],
    ['12,90', 'unitPrice', 129_000],
    ['1,250.00', 'ils', 125_000],
    ['0,250', 'qty', 250],
    ['2,5', 'qty', 2500],
    ['1.250', 'ils', 'ambiguous:thousands-or-three-decimals'],
    ['1.250', 'unitPrice', 12_500],
    ['1.250', 'qty', 1250],
    ['1.250.000', 'qty', 'invalid:grouping-not-allowed'],
    ['1,234.500', 'qty', 1_234_500],
    ['12.5%', 'percent', 1250],
    ['0.25', 'percent', 25],
    ['12.345', 'unitPrice', 123_450],
    ['12.34567', 'unitPrice', 'invalid:too-many-decimals'],
    ['0.125', 'ils', 'invalid:too-many-decimals'],
    ['abc', 'ils', 'invalid:not-a-number'],
    ['1,2,3', 'ils', 'invalid:not-a-number'],
    ['', 'ils', 'empty'],
    ['   ', 'qty', 'empty'],
  ])('%s as %s → %s', (raw, kind, want) => {
    expect(okField(kind, raw)).toBe(want);
  });

  it.each<DecimalKind>(['ils', 'unitPrice', 'qty', 'percent'])("'1.234,50' as %s: ok only in a comma-decimal file", (kind) => {
    expect(okField(kind, '1.234,50')).toBe('invalid:comma-decimal-needs-comma-file');
    const want = { ils: 123_450, unitPrice: 12_345_000, qty: 1_234_500, percent: 123_450 }[kind];
    expect(okField(kind, '1.234,50', { decimal: 'comma' })).toBe(want);
  });

  it.each<DecimalKind>(['ils', 'unitPrice', 'qty', 'percent'])("'-5' as %s: invalid unless negative:true", (kind) => {
    expect(okField(kind, '-5')).toBe('invalid:negative-not-allowed');
    expect(okField(kind, '(5)')).toBe('invalid:negative-not-allowed');
    const want = { ils: -500, unitPrice: -50_000, qty: -5000, percent: -500 }[kind];
    expect(okField(kind, '-5', { negative: true })).toBe(want);
  });

  it('null/undefined are empty; ok carries the value too', () => {
    expect(parseDecimalInput(null, 'ils')).toEqual({ kind: 'empty' });
    expect(parseDecimalInput(undefined, 'qty')).toEqual({ kind: 'empty' });
    expect(parseDecimalInput('12,90', 'ils')).toEqual({ kind: 'ok', value: 12.9, agorot: 1290 });
    expect(parseDecimalInput('1,250', 'qty')).toEqual({
      kind: 'ambiguous',
      raw: '1,250',
      reason: 'thousands-or-decimal-comma',
    });
  });

  it('a too-large number is out-of-range, never a rounded float', () => {
    expect(okField('ils', '99999999999999999')).toBe('invalid:out-of-range');
  });
});

describe('parseDecimalInput ∘ moneyText round trip (seeded, no Math.random)', () => {
  // mulberry32: a deterministic PRNG so a failure is reproducible.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const N = 200;

  it.each(['he', 'en'] as const)('ils (agorot, context line) in %s', (locale) => {
    const r = rng(13);
    for (let i = 0; i < N; i++) {
      const agorot = Math.floor(r() * 1e9) * (i % 10 === 0 ? -1 : 1);
      const text = moneyText({ agorot }, { locale, context: 'line' });
      expect(parseDecimalInput(text, 'ils', { negative: true })).toMatchObject({ kind: 'ok', agorot });
    }
  });

  it.each(['he', 'en'] as const)('unitPrice (price units, context unit) in %s', (locale) => {
    const r = rng(29);
    for (let i = 0; i < N; i++) {
      const priceUnits = Math.floor(r() * 1e10);
      const text = moneyText({ value: priceUnits / 10_000 }, { locale, context: 'unit' });
      expect(parseDecimalInput(text, 'unitPrice')).toMatchObject({ kind: 'ok', priceUnits });
    }
  });

  it('qty (milli, he-IL digits, no grouping: a quantity is never grouped)', () => {
    const r = rng(41);
    const fmt = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 3, useGrouping: false });
    for (let i = 0; i < N; i++) {
      const milli = Math.floor(r() * 1e9);
      expect(parseDecimalInput(fmt.format(milli / 1000), 'qty')).toMatchObject({ kind: 'ok', milli });
    }
  });

  it('percent (basis points, Intl percent)', () => {
    const r = rng(53);
    const fmt = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 2, useGrouping: false });
    for (let i = 0; i < N; i++) {
      const basisPoints = Math.floor(r() * 10_001);
      expect(parseDecimalInput(fmt.format(basisPoints / 10_000), 'percent')).toMatchObject({ kind: 'ok', basisPoints });
    }
  });
});

describe('detectDecimalStyle', () => {
  it.each<[string[], 'auto' | 'comma']>([
    [['1.250,00', '12'], 'comma'],
    [['₪ 1.234.567,5'], 'comma'],
    [['1,250.00', '12,5'], 'auto'],
    [['1.250', '7'], 'auto'],
    [[], 'auto'],
  ])('%j → %s', (cells, want) => {
    expect(detectDecimalStyle([...cells, null, undefined])).toBe(want);
  });
});
