import { describe, expect, it } from 'vitest';
import { isBarcodeQuery, normalizeForSearch, searchItems } from '../search-adapter';

describe('W3-10 catalog search on normalizeHe', () => {
  it('uses normalizeHe: niqqud, final letters, gershayim, dashes', () => {
    expect(normalizeForSearch('  שָׁלוֹם ')).toBe('שלומ');
    expect(normalizeForSearch('ק״ג')).toBe(normalizeForSearch('קג'));
    expect(normalizeForSearch('Tomato-Cherry')).toBe('tomato cherry');
  });

  const items = [
    { name: 'עגבניה שרי', aliases: ['שרי אדום'], supplierSku: 'T-1', barcodeEan: '7290000000017' },
    { name: 'עגבניה', supplierSku: 'T-2', barcodeEan: null },
    { name: 'רסק עגבניות', supplierSku: null },
    { name: 'מלפפון', supplierSku: 'C-1' },
  ];

  it('ranks exact > prefix > every-word; finals do not block a match', () => {
    expect(searchItems(items, 'עגבניה').map((i) => i.name)).toEqual(['עגבניה', 'עגבניה שרי']);
    // a word prefix reaches the plural; ties keep the caller's order
    expect(searchItems(items, 'עגבני').map((i) => i.name)).toEqual(['עגבניה שרי', 'עגבניה', 'רסק עגבניות']);
    expect(searchItems(items, 'שרי').map((i) => i.name)).toEqual(['עגבניה שרי']);
    expect(searchItems([{ name: 'סלמון' }], 'סלמו').length).toBe(1);
  });

  it('SKU and barcode', () => {
    expect(searchItems(items, 't-2').map((i) => i.name)[0]).toBe('עגבניה');
    expect(isBarcodeQuery('7290000000017')).toBe(true);
    expect(searchItems(items, '7290000000017').map((i) => i.name)).toEqual(['עגבניה שרי']);
    expect(searchItems(items, '7290000000099')).toEqual([]);
  });

  it('an empty query returns everything in order', () => {
    expect(searchItems(items, '  ')).toBe(items);
  });
});
