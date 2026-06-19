import { describe, expect, it } from 'vitest';
import {
  autoDetectMapping,
  extractCatalogRows,
  parseCatalogFile,
  parseNumeric,
} from '../catalog/parse';

describe('parseNumeric', () => {
  it('strips the shekel sign and parses', () => {
    expect(parseNumeric('₪12.50')).toBe(12.5);
  });
  it('treats comma as thousands when a dot is present', () => {
    expect(parseNumeric('1,234.56')).toBe(1234.56);
  });
  it('treats a lone comma as a decimal separator (European)', () => {
    expect(parseNumeric('12,50')).toBe(12.5);
  });
  it('returns null for empty / non-numeric', () => {
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('   ')).toBeNull();
    expect(parseNumeric('abc')).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });
  it('parses a plain integer', () => {
    expect(parseNumeric('5')).toBe(5);
  });
});

describe('autoDetectMapping (Hebrew headers)', () => {
  it('maps common Hebrew price-list headers', () => {
    const mapping = autoDetectMapping(['מק"ט', 'תיאור', 'יחידה', 'מחיר', 'ברקוד']);
    expect(mapping).toMatchObject({
      sku: 'מק"ט',
      name: 'תיאור',
      unit: 'יחידה',
      price: 'מחיר',
      barcode: 'ברקוד',
    });
  });
  it('does not assign the same header to two fields', () => {
    const mapping = autoDetectMapping(['שם המוצר', 'מחיר ליחידה']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('parseCatalogFile + extractCatalogRows (CSV)', () => {
  const csv = ['מק"ט,תיאור,יחידה,מחיר', '1001,עגבניות,ק"ג,8.50', '1002,מלפפון,ק"ג,6.00'].join('\n');

  it('parses headers and rows', () => {
    const table = parseCatalogFile({ filename: 'prices.csv', text: csv });
    expect(table.headers).toEqual(expect.arrayContaining(['תיאור', 'מחיר']));
    expect(table.rows).toHaveLength(2);
  });

  it('projects rows onto catalog rows via the auto mapping', () => {
    const table = parseCatalogFile({ filename: 'prices.csv', text: csv });
    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      supplierSku: '1001',
      supplierNameRaw: 'עגבניות',
      unit: 'ק"ג',
      listPrice: 8.5,
    });
  });

  it('skips rows without a product name', () => {
    const csvWithBlank = ['מק"ט,תיאור,מחיר', '2001,,9.90', '2002,בצל,4.20'].join('\n');
    const table = parseCatalogFile({ filename: 'p.csv', text: csvWithBlank });
    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.supplierNameRaw).toBe('בצל');
  });
});
