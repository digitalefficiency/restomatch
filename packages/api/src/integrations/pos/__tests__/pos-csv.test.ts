import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvPosProvider, detectPosColumns, parsePosDate, parseScaled, PosFileError } from '../index';

const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

describe('POS CSV adapter', () => {
  it('Hebrew Windows-1255 per-ticket export: sums per day · item, exact money, reports bad lines', () => {
    const out = csvPosProvider.parse({ filename: 'z.csv', bytes: fx('pos-sales-he-windows1255.csv') });
    expect(out.columns).toEqual({ date: 'תאריך', itemRef: 'קוד פריט', itemName: 'שם פריט', qty: 'כמות', net: 'מכירות נטו' });
    expect(out.rows).toEqual([
      { soldOn: '2026-10-01', itemRef: '101', itemName: 'שקשוקה', qtyMilli: 5000, netAgorot: 27000 },
      { soldOn: '2026-10-01', itemRef: '205', itemName: 'סלט ירקות', qtyMilli: 4000, netAgorot: 100000 },
      { soldOn: '2026-10-01', itemRef: '310', itemName: 'המבורגר "הבית"', qtyMilli: 1000, netAgorot: 6450 },
      { soldOn: '2026-10-02', itemRef: '101', itemName: 'שקשוקה', qtyMilli: 500, netAgorot: 2700 },
    ]);
    expect(out.issues).toEqual([
      { line: 7, code: 'BAD_DATE' },
      { line: 8, code: 'NO_ITEM' },
      { line: 9, code: 'BAD_QTY' },
    ]);
  });

  it('English UTF-8 (BOM) export with ₪ amounts', () => {
    const out = csvPosProvider.parse({ filename: 'sales.csv', bytes: fx('pos-sales-en-utf8.csv') });
    expect(out.columns).toMatchObject({ date: 'Business Day', itemRef: 'PLU', itemName: 'Item Name', qty: 'Qty', net: 'Net Sales' });
    expect(out.rows.map((r) => [r.soldOn, r.itemRef, r.netAgorot])).toEqual([
      ['2026-10-01', '101', 27000],
      ['2026-10-01', '205', 100000],
      ['2026-10-02', '101', 5400],
    ]);
    expect(out.issues).toEqual([]);
  });

  it('names what is missing instead of guessing', () => {
    try {
      csvPosProvider.parse({ filename: 'x.csv', bytes: fx('pos-sales-missing-columns.csv') });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PosFileError);
      expect((e as PosFileError).code).toBe('NO_COLUMNS');
      expect((e as PosFileError).missing).toEqual(['qty', 'net']);
    }
    expect(() => csvPosProvider.parse({ filename: 'e.csv', bytes: new Uint8Array() })).toThrow(PosFileError);
  });

  it('parsers', () => {
    expect(parsePosDate('31/12/2026')).toBe('2026-12-31');
    expect(parsePosDate('1.2.26 14:05')).toBe('2026-02-01');
    expect(parsePosDate('2026-02-30')).toBeNull();
    expect(parseScaled('1,234.56', 2)).toBe(123456);
    expect(parseScaled('12,5', 3)).toBe(12500);
    expect(parseScaled('0.1', 2)).toBe(10);
    expect(parseScaled('-3.205', 2)).toBe(-321);
    expect(parseScaled('x', 2)).toBeNull();
    expect(detectPosColumns(['קוד מנה', 'שם מנה', 'יום עסקים', 'יחידות', 'סה"כ'])).toEqual({
      date: 'יום עסקים',
      itemRef: 'קוד מנה',
      itemName: 'שם מנה',
      qty: 'יחידות',
      net: 'סה"כ',
    });
  });
});
