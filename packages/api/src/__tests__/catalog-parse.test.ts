import ExcelJS from 'exceljs';
const { Workbook } = ExcelJS;
import { describe, expect, it } from 'vitest';
import {
  analyzeCatalogRows,
  autoDetectMapping,
  detectVatBasis,
  extractCatalogRows,
  parseCatalogFile,
  parseNumeric,
} from '../catalog/parse';
import {
  detectDecimalStyle,
  exVatPriceUnits,
  parseMoneyCell,
  parsePriceCell,
  priceUnitsToNumeric,
  toPriceUnits,
} from '../lib/parseMoneyCell';

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
  it('does not take an item-code column ("קוד פריט") as the product name', () => {
    expect(autoDetectMapping(['קוד פריט', 'שם מוצר', "יח' מידה", 'מחיר'])).toMatchObject({
      sku: 'קוד פריט',
      name: 'שם מוצר',
      price: 'מחיר',
    });
    expect(autoDetectMapping(['Item code', 'Item description', 'Price'])).toMatchObject({
      sku: 'Item code',
      name: 'Item description',
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

// ── W1-10 · price-list money safety (catalog-02 / -37) ─────────────────────────
describe('strict money cells (catalog-02: "1,250" was stored as ₪1.25)', () => {
  it.each([
    ['1,250', 1250],
    ['₪1,250', 1250],
    ['1,250,000', 1_250_000],
    ['12,90', 12.9],
    ['7,5', 7.5],
    ['1,250.00', 1250],
    ['₪ 2,400', 2400],
    ['2,400 ₪', 2400],
    ['12.5', 12.5],
    ['1250', 1250],
    ['0', 0],
    ['45 ש"ח', 45],
  ])('%s → %d', (raw, expected) => {
    expect(parseMoneyCell(raw)).toEqual({ kind: 'ok', value: expected });
    expect(parseNumeric(raw)).toBe(expected);
  });
  it.each(['-5', '(5)', '1e3', '1,2345', '1.250,5', 'abc', '₪', '12-'])('rejects %s', (raw) => {
    expect(parseMoneyCell(raw).kind).toBe('invalid');
    expect(parseNumeric(raw)).toBeNull();
  });
  it('empty is empty, not invalid', () => {
    expect(parseMoneyCell('  ')).toEqual({ kind: 'empty' });
    expect(parseMoneyCell(null)).toEqual({ kind: 'empty' });
  });
  it('a comma-decimal file ("1.250,00" in its own cells) reads dots as thousands', () => {
    expect(detectDecimalStyle(['12', '1.250,00', '7,5'])).toBe('comma');
    expect(detectDecimalStyle(['1,250', '12,90'])).toBe('auto');
    expect(parseMoneyCell('1.250,50', 'comma')).toEqual({ kind: 'ok', value: 1250.5 });
    expect(parseMoneyCell('7,5', 'comma')).toEqual({ kind: 'ok', value: 7.5 });
    expect(parseMoneyCell('1.250', 'comma')).toEqual({ kind: 'ok', value: 1250 });
    expect(parseMoneyCell('-5', 'comma').kind).toBe('invalid');
  });
  it('the contract importer keeps its number-or-null API on the same parser', () => {
    expect(parsePriceCell('1,250')).toBe(1250);
    expect(parsePriceCell('12,5')).toBe(12.5);
    expect(parsePriceCell('-5')).toBeNull();
  });
});

describe('analyzeCatalogRows: held rows, VAT basis', () => {
  const table = {
    headers: ['מק"ט', 'תיאור', 'מחיר'],
    rows: [
      { 'מק"ט': 'A1', תיאור: 'שמן זית 18 ל׳', מחיר: '1,250' },
      { 'מק"ט': 'A2', תיאור: 'אורז יסמין', מחיר: '12,90' },
      { 'מק"ט': 'A3', תיאור: 'מלח', מחיר: '-5' },
      { 'מק"ט': 'A4', תיאור: 'סוכר', מחיר: 'לפי משקל' },
      { 'מק"ט': 'A5', תיאור: 'פלפל', מחיר: '' },
    ],
  };
  const mapping = { sku: 'מק"ט', name: 'תיאור', price: 'מחיר' };

  it('commits only readable prices and lists the rest as held ("מחיר לא ברור")', () => {
    const a = analyzeCatalogRows(table, mapping);
    expect(a.rows.map((r) => [r.supplierSku, r.listPrice])).toEqual([
      ['A1', 1250],
      ['A2', 12.9],
      ['A5', null],
    ]);
    expect(a.held).toEqual([
      // Spreadsheet line numbers: the header is line 1, so the 3rd data row is line 4.
      { rowNumber: 4, supplierNameRaw: 'מלח', supplierSku: 'A3', rawPrice: '-5', reason: 'UNCLEAR_PRICE' },
      { rowNumber: 5, supplierNameRaw: 'סוכר', supplierSku: 'A4', rawPrice: 'לפי משקל', reason: 'UNCLEAR_PRICE' },
    ]);
    // The worker's path uses the same rows: a held row can never be stored as a guess.
    expect(extractCatalogRows(table, mapping).map((r) => r.supplierSku)).toEqual(['A1', 'A2', 'A5']);
  });

  it('converts a VAT-inclusive list to ex-VAT with the restaurant rate (half-up, 4 dp)', () => {
    const a = analyzeCatalogRows(table, { ...mapping, vatBasis: 'inc', vatRate: '0.1800' });
    // 1250 / 1.18 = 1059.32203… → 1059.3220 ; 12.90 / 1.18 = 10.93220… → 10.9322
    expect(a.rows.map((r) => r.listPrice)).toEqual([1059.322, 10.9322, null]);
    expect(analyzeCatalogRows(table, { ...mapping, vatBasis: 'ex', vatRate: '0.18' }).rows[0]!.listPrice).toBe(1250);
  });

  it('half-up at the 4th decimal in integer price units', () => {
    expect(exVatPriceUnits(toPriceUnits(118), 0.18)).toBe(1_000_000);
    expect(priceUnitsToNumeric(exVatPriceUnits(toPriceUnits(1), 0.18))).toBe('0.8475'); // 0.847457…
    expect(priceUnitsToNumeric(123_456)).toBe('12.3456');
  });

  it('pre-sets the VAT basis from the PRICE column\'s header only', () => {
    expect(detectVatBasis('מחיר כולל מע"מ')).toBe('inc');
    expect(detectVatBasis('מחיר כולל מע״מ')).toBe('inc');
    expect(detectVatBasis('Price incl. VAT')).toBe('inc');
    expect(detectVatBasis('מחיר לא כולל מע"מ')).toBe('ex');
    expect(detectVatBasis('מחיר')).toBeNull();
    expect(detectVatBasis(undefined)).toBeNull();
  });

  it('reads a comma-decimal file per its own locale', () => {
    const t = {
      headers: ['תיאור', 'מחיר'],
      rows: [
        { תיאור: 'שמן', מחיר: '1.250,00' },
        { תיאור: 'מלח', מחיר: '7,5' },
      ],
    };
    const a = analyzeCatalogRows(t, { name: 'תיאור', price: 'מחיר' });
    expect(a.decimal).toBe('comma');
    expect(a.rows.map((r) => r.listPrice)).toEqual([1250, 7.5]);
  });
});

// ── W1-10 review fixes ─────────────────────────────────────────────────────────
describe('review: "0,125" is a decimal, never thousands (finding 3)', () => {
  it.each([
    ['0,125', 0.125],
    ['0,750', 0.75],
    ['₪0,125', 0.125],
    ['0,5', 0.5],
  ])('%s → %d', (raw, expected) => {
    expect(parseMoneyCell(raw)).toEqual({ kind: 'ok', value: expected });
  });
  it('real thousands still group: "1,250" → 1250, "10,125" → 10125', () => {
    expect(parseNumeric('1,250')).toBe(1250);
    expect(parseNumeric('10,125')).toBe(10125);
  });
  it('a comma-decimal file never reads "0.125" as thousands', () => {
    expect(parseMoneyCell('0.125', 'comma').kind).toBe('invalid');
  });
});

describe('review: typed Excel numbers and real row numbers (findings 6, 12)', () => {
  it('a comma-decimal column keeps a typed number as is (no 1000× re-read)', async () => {
    const buf = await xlsxBufferFromAoa([
      ['תיאור', 'מחיר'],
      ['שמן', '1.250,00'],
      ['מלח', 1.125],
      [],
      ['סוכר', 'abc'],
    ]);
    const table = await parseCatalogFile({ filename: 'p.xlsx', base64: buf.toString('base64') });
    const a = analyzeCatalogRows(table, { name: 'תיאור', price: 'מחיר' });
    expect(a.decimal).toBe('comma');
    expect(a.rows.map((r) => [r.supplierNameRaw, r.listPrice, r.rowNumber])).toEqual([
      ['שמן', 1250, 2],
      ['מלח', 1.125, 3],
    ]);
    // The blank row 4 is skipped but row 5 keeps its number.
    expect(a.held.map((h) => h.rowNumber)).toEqual([5]);
  });
  it('a CSV keeps its line numbers across blank lines', async () => {
    const table = await parseCatalogFile({ filename: 'p.csv', text: 'תיאור,מחיר\nשמן,10\n\nמלח,-5\n' });
    expect(analyzeCatalogRows(table, { name: 'תיאור', price: 'מחיר' }).held[0]!.rowNumber).toBe(4);
  });
});
