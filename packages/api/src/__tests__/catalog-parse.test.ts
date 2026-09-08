import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
import { describe, expect, it } from 'vitest';
import {
  autoDetectMapping,
  extractCatalogRows,
  parseCatalogFile,
  parseNumeric,
} from '../catalog/parse';

/** Build a real .xlsx buffer from an array-of-arrays (used by the XLSX tests). */
async function xlsxBufferFromAoa(aoa: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet('Sheet1');
  for (const row of aoa) ws.addRow(row);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

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

  it('parses headers and rows', async () => {
    const table = await parseCatalogFile({ filename: 'prices.csv', text: csv });
    expect(table.headers).toEqual(expect.arrayContaining(['תיאור', 'מחיר']));
    expect(table.rows).toHaveLength(2);
  });

  it('projects rows onto catalog rows via the auto mapping', async () => {
    const table = await parseCatalogFile({ filename: 'prices.csv', text: csv });
    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      supplierSku: '1001',
      supplierNameRaw: 'עגבניות',
      unit: 'ק"ג',
      listPrice: 8.5,
    });
  });

  it('skips rows without a product name', async () => {
    const csvWithBlank = ['מק"ט,תיאור,מחיר', '2001,,9.90', '2002,בצל,4.20'].join('\n');
    const table = await parseCatalogFile({ filename: 'p.csv', text: csvWithBlank });
    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.supplierNameRaw).toBe('בצל');
  });
});

describe('parseCatalogFile + extractCatalogRows (XLSX via exceljs)', () => {
  it('parses Hebrew headers and rows from a real .xlsx buffer', async () => {
    const buf = await xlsxBufferFromAoa([
      ['מק"ט', 'תיאור', 'יחידה', 'מחיר'],
      ['1001', 'עגבניות', 'ק"ג', '8.50'],
      ['1002', 'מלפפון', 'ק"ג', 6],
    ]);
    const table = await parseCatalogFile({ filename: 'prices.xlsx', base64: buf.toString('base64') });
    expect(table.headers).toEqual(expect.arrayContaining(['תיאור', 'מחיר']));
    expect(table.rows).toHaveLength(2);

    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      supplierSku: '1001',
      supplierNameRaw: 'עגבניות',
      unit: 'ק"ג',
      listPrice: 8.5,
    });
    expect(rows[1]!.listPrice).toBe(6);
  });

  it('does not pollute Object.prototype from a hostile __proto__ header', async () => {
    const buf = await xlsxBufferFromAoa([
      ['__proto__', 'constructor', 'תיאור', 'מחיר'],
      ['polluted', 'evil', 'בצל', '4.20'],
    ]);
    const table = await parseCatalogFile({ filename: 'evil.xlsx', base64: buf.toString('base64') });
    // The parse must not have mutated the global prototype chain.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    // The legitimate row data is still readable.
    const rows = extractCatalogRows(table, autoDetectMapping(table.headers));
    expect(rows[0]!.supplierNameRaw).toBe('בצל');
  });

  it('rejects an oversized spreadsheet before parsing', async () => {
    // 10 MiB + 1 byte of arbitrary bytes — must be refused by the size guard,
    // not handed to the parser.
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    await expect(
      parseCatalogFile({ filename: 'huge.xlsx', base64: oversized.toString('base64') }),
    ).rejects.toThrow(/גדול מדי/);
  });
});
