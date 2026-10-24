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
      { line: 8, code: 'NO_ITEM', soldOn: '2026-10-02' },
      { line: 9, code: 'BAD_QTY', soldOn: '2026-10-02' },
    ]);
    expect(out.rejectedDays).toEqual([]); // 2 Oct still has a valid row
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
    // Money with 3 decimals is ambiguous ("1.234" = ₪1,234 in a European export): refused.
    expect(parseScaled('-3.205', 2)).toBeNull();
    expect(parseScaled('-3.205', 3)).toBe(-3205);
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

describe('POS CSV adapter — refuter regressions', () => {
  const csv = (text: string) => ({ filename: 'r.csv', bytes: new TextEncoder().encode(text) });

  it('discount / VAT / "updated" columns are never taken as net, qty or date', () => {
    expect(detectPosColumns(['Date', 'Item', 'Qty', 'Discount Amount', 'Total'])).toMatchObject({ qty: 'Qty', net: 'Total' });
    expect(detectPosColumns(['Date', 'Item', 'Discount', 'Count', 'Total'])).toMatchObject({ qty: 'Count', net: 'Total' });
    expect(detectPosColumns(['תאריך', 'פריט', 'כמות', 'סכום הנחה', 'מכירות'])).toMatchObject({ net: 'מכירות' });
    expect(detectPosColumns(['Last Updated', 'Date', 'Item', 'Qty', 'Net'])).toMatchObject({ date: 'Date' });
  });

  it('refund lines net out instead of being dropped', () => {
    const out = csvPosProvider.parse(csv('date,item,qty,net\n2026-10-01,Burger,2,100.00\n2026-10-01,Burger,-1,-50.00\n'));
    expect(out.rows).toEqual([{ soldOn: '2026-10-01', itemRef: 'Burger', itemName: 'Burger', qtyMilli: 1000, netAgorot: 5000 }]);
    expect(out.issues).toEqual([]);
    // A negative count with a positive amount is still nonsense.
    expect(csvPosProvider.parse(csv('date,item,qty,net\n2026-10-01,X,-1,5\n')).issues).toEqual([
      { line: 2, code: 'BAD_QTY', soldOn: '2026-10-01' },
    ]);
  });

  it('number formats: decimal comma, European, trailing minus, parentheses', () => {
    expect(parseScaled('0,500', 3)).toBe(500);
    expect(parseScaled('1.234,50', 2)).toBe(123450);
    expect(parseScaled('1,234', 2)).toBe(123400);
    expect(parseScaled('50.00-', 2)).toBe(-5000);
    expect(parseScaled('(50.00)', 2)).toBe(-5000);
  });

  it('a future day (typo) and a row split by an unquoted comma are reported, not imported', () => {
    const out = csvPosProvider.parse(csv('date,item,qty,net\n15/09/2062,X,1,10\n2026-10-01,Y,1,₪ 1,234.56\n2026-10-01,Z,1,10\n'));
    expect(out.rows.map((r) => r.itemRef)).toEqual(['Z']);
    expect(out.issues).toEqual([
      { line: 2, code: 'BAD_DATE' },
      { line: 3, code: 'BAD_ROW' },
    ]);
  });

  it('values beyond the NUMERIC columns are line issues, not a 500', () => {
    const out = csvPosProvider.parse(csv('date,item,qty,net\n2026-10-01,X,1000000000,10\n2026-10-01,Y,1,99999999999\n'));
    expect(out.rows).toEqual([]);
    expect(out.issues.map((i) => i.code)).toEqual(['BAD_QTY', 'BAD_AMOUNT']);
  });
});

describe('POS CSV adapter — S1 cross-QA', () => {
  const csv = (text: string) => ({ filename: 'r.csv', bytes: new TextEncoder().encode(text) });

  it('ambiguous numbers are refused, never guessed', () => {
    expect(parseScaled('1.234', 2)).toBeNull(); // ₪1.234 or European ₪1,234?
    expect(parseScaled('1,250', 3)).toBeNull(); // 1,250 units or 1.25 kg?
    expect(parseScaled('(-5)', 2)).toBeNull();
    expect(parseScaled('-5-', 2)).toBeNull();
    expect(parseScaled('1.234.567', 2)).toBe(123456700);
    expect(parseScaled('1,5', 3)).toBe(1500);
    expect(parseScaled('1,234', 2)).toBe(123400);
    expect(parseScaled('1.234,5', 2)).toBe(123450);
    expect(parseScaled('1,23,4.5', 2)).toBeNull();
  });

  it('cashier / register codes are never the item code; gross is never the net', () => {
    expect(detectPosColumns(['תאריך', 'קוד קופאי', 'קוד פריט', 'שם פריט', 'כמות', 'מכירות נטו'])).toMatchObject({
      itemRef: 'קוד פריט',
      net: 'מכירות נטו',
    });
    expect(detectPosColumns(['Date', 'Cashier Code', 'Item', 'Qty', 'Gross Total'])).toMatchObject({
      itemRef: null,
      net: null,
    });
    expect(() => csvPosProvider.parse(csv('Date,Item,Qty,Gross Total\n2026-10-01,Soup,1,11.80\n'))).toThrow(PosFileError);
  });

  it('line numbers are the file lines, across blank lines and quoted multi-line cells', () => {
    const text = 'date,item,qty,net\n\n2026-10-01,"Soup\nof the day",1,10\n\n2026-10-01,Bad,x,10\n2026-13-01,Y,1,1\n';
    const out = csvPosProvider.parse(csv(text));
    expect(out.rows).toHaveLength(1);
    expect(out.issues).toEqual([
      { line: 6, code: 'BAD_QTY', soldOn: '2026-10-01' },
      { line: 7, code: 'BAD_DATE' },
    ]);
  });

  it('a day whose every row was rejected is reported (its old data stays)', () => {
    const out = csvPosProvider.parse(csv('date,item,qty,net\n2026-10-01,A,1,10\n2026-10-02,B,x,10\n'));
    expect(out.rejectedDays).toEqual(['2026-10-02']);
  });
});
