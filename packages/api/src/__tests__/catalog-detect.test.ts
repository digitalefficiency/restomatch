import { describe, expect, it } from 'vitest';
import { detectHeaderRow, pickSheet } from '../catalog/detect';

const priceList = [
  ['ירקות השרון בע״מ', '', ''],
  ['מחירון לנובמבר 2026', '', ''],
  ['', '', ''],
  ['מק״ט', 'תיאור פריט', 'יחידה', 'מחיר'],
  ['T-1', 'עגבניה', 'ק״ג', '5.50'],
  ['C-2', 'מלפפון', 'ק״ג', '3,75'],
  ['P-9', 'פטרוזיליה', 'צרור', '2'],
];

describe('W3-10 detectHeaderRow', () => {
  it('finds a header below a letterhead block', () => {
    const g = detectHeaderRow(priceList);
    expect(g).not.toBeNull();
    expect(g!.headerIndex).toBe(3);
    expect(g!.mapping).toMatchObject({ sku: 'מק״ט', name: 'תיאור פריט', unit: 'יחידה', price: 'מחיר' });
    expect(g!.pricedRows).toBe(3);
  });

  it('returns null when no row maps both a name and a price', () => {
    expect(detectHeaderRow([['שלום', 'עולם'], ['1', '2']])).toBeNull();
  });

  it('never takes a row of numbers for a header', () => {
    expect(detectHeaderRow([['1', '2', '3']])).toBeNull();
  });

  it('only scans the first N rows', () => {
    const late = [...Array.from({ length: 25 }, () => ['']), ['שם', 'מחיר'], ['x', '1']];
    expect(detectHeaderRow(late)).toBeNull();
    expect(detectHeaderRow(late, 30)?.headerIndex).toBe(25);
  });
});

describe('W3-10 pickSheet', () => {
  it('skips a cover sheet and picks the sheet with the most priced rows', () => {
    const cover = [['שם הספק', 'מחיר כולל'], ['ירקות השרון', '']];
    const g = pickSheet([
      { name: 'שער', grid: cover },
      { name: 'מחירון', grid: priceList },
    ]);
    expect(g?.sheetName).toBe('מחירון');
    expect(g?.headerIndex).toBe(3);
  });
  it('null when no sheet is a price list', () => {
    expect(pickSheet([{ name: 'a', grid: [['x']] }])).toBeNull();
  });
});
