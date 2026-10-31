import { describe, expect, it } from 'vitest';
import { parseMoneyCell } from '../../../../../../packages/api/src/lib/parseMoneyCell';
import {
  confidenceWord,
  formatPriceInput,
  isSaveShortcut,
  parsePriceInput,
  suggestionBasis,
} from '../money-logic';

const CASES = [
  '1,250',
  '₪1,250',
  '1,250,000',
  '12,90',
  '7,5',
  '1,250.00',
  '₪ 2,400',
  '12.5',
  '0',
  '',
  '-5',
  '1,2345',
  'abc',
  '1.250,5',
  '1e3',
  '0,125',
  '0,750',
];

describe('typed catalog prices (catalog-02 / -20)', () => {
  it('parse like an imported cell: "1,250" → 1250, "7,5" → 7.5, "-5" invalid', () => {
    expect(parsePriceInput('1,250')).toBe(1250);
    expect(parsePriceInput('7,5')).toBe(7.5);
    expect(parsePriceInput('12,90')).toBe(12.9);
    expect(parsePriceInput('1,250.50')).toBe(1250.5);
    // A leading "0," is a decimal comma, never thousands (review finding 3).
    expect(parsePriceInput('0,125')).toBe(0.125);
    expect(parsePriceInput('0,750')).toBe(0.75);
    expect(parsePriceInput('  ')).toBeNull();
    expect(parsePriceInput('-5')).toBe('invalid');
    // At most 4 decimals (NUMERIC(12,4)): "1,2345" is a decimal comma, a 5th decimal is refused.
    expect(parsePriceInput('1,2345')).toBe(1.2345);
    expect(parsePriceInput('1,23456')).toBe('invalid');
  });

  it.each(CASES)('parity with the import parser: %s', (raw) => {
    const cell = parseMoneyCell(raw);
    const expected = cell.kind === 'ok' ? cell.value : cell.kind === 'empty' ? null : 'invalid';
    expect(parsePriceInput(raw)).toBe(expected);
  });

  it('formats on blur to a value that re-parses to itself', () => {
    expect(formatPriceInput('7,5')).toBe('7.50');
    expect(formatPriceInput('1,250')).toBe('1250.00');
    expect(formatPriceInput('9.8')).toBe('9.80');
    expect(formatPriceInput('0.0095')).toBe('0.0095');
    expect(formatPriceInput('abc')).toBe('abc');
    for (const raw of ['7,5', '1,250', '12.345']) {
      expect(parsePriceInput(formatPriceInput(raw))).toBe(parsePriceInput(raw));
    }
  });
});

describe('review wording (catalog-50)', () => {
  it('confidence is a word, not a %', () => {
    expect(confidenceWord(0.95)).toBe('high');
    expect(confidenceWord(0.8)).toBe('medium');
    expect(confidenceWord(0.62)).toBe('low');
  });
  it('the basis line names how it matched and what differs', () => {
    expect(
      suggestionBasis({
        matchedBy: 'fuzzy',
        unit: 'ק״ג',
        productUnit: 'ק״ג',
        reasons: ['MEDIUM_CONFIDENCE'],
      }),
    ).toEqual(['name', 'sameSupplier', 'sameUnit']);
    expect(
      suggestionBasis({
        matchedBy: 'sku',
        unit: 'ארגז',
        productUnit: 'ק״ג',
        reasons: ['UNIT_MISMATCH', 'PACK_MISMATCH'],
      }),
    ).toEqual(['sku', 'sameSupplier', 'otherUnit', 'otherPack']);
  });
});

describe('Ctrl+S by physical key (catalog-40)', () => {
  it('fires on a Hebrew layout (key "ד", code "KeyS")', () => {
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, code: 'KeyS' })).toBe(true);
    expect(isSaveShortcut({ ctrlKey: false, metaKey: true, code: 'KeyS' })).toBe(true);
    expect(isSaveShortcut({ ctrlKey: true, metaKey: false, code: 'KeyD' })).toBe(false);
    expect(isSaveShortcut({ ctrlKey: false, metaKey: false, code: 'KeyS' })).toBe(false);
  });
});
