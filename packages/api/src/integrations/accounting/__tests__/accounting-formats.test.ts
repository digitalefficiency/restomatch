import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNTING_CONFIG,
  encodeWindows1255,
  numericToAgorot,
  renderAccountingFile,
  type AccountingConfig,
  type AccountingFormat,
  type AccountingInvoice,
} from '../index';

/**
 * Golden-file tests for the accounting-package exports (wave-1 `integrations`).
 * The golden files are the exact bytes an accountant imports. Regenerate only
 * on a deliberate format change: UPDATE_GOLDEN=1 pnpm vitest run accounting-formats
 * and review the diff (decode with the encoding named in each test).
 */
const GOLDEN = join(__dirname, 'golden');
const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

const INVOICES: AccountingInvoice[] = [
  {
    invoiceNumber: 'BR-24118',
    invoiceDate: '2026-10-01',
    supplierId: '11111111-1111-4111-8111-111111111111',
    supplierName: 'מאפיית ברנר',
    supplierBusinessId: '514200103',
    totalExclAgorot: 52414,
    vatAgorot: 9435,
    totalInclAgorot: 61849,
  },
  {
    invoiceNumber: '000731',
    invoiceDate: '2026-10-15',
    supplierId: '22222222-2222-4222-8222-222222222222',
    supplierName: 'חד״פ מהיר\tבע״מ', // a tab in a name must not break the record
    supplierBusinessId: '',
    totalExclAgorot: 10000,
    vatAgorot: 1800,
    totalInclAgorot: 11800,
  },
  {
    invoiceNumber: 'SH-9',
    invoiceDate: '2026-10-31',
    supplierId: '33333333-3333-4333-8333-333333333333',
    supplierName: 'ירקות השרון',
    supplierBusinessId: '51-234567-8',
    totalExclAgorot: 85506,
    vatAgorot: 15391,
    totalInclAgorot: 100897,
  },
];

const CFG: AccountingConfig = {
  ...DEFAULT_ACCOUNTING_CONFIG,
  // The accountant mapped one supplier to an existing card.
  supplierAccounts: { '33333333-3333-4333-8333-333333333333': '40015' },
};

function golden(format: AccountingFormat, bytes: Uint8Array, ext: string) {
  const path = join(GOLDEN, `${format}.${ext}`);
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(path)) writeFileSync(path, bytes);
  expect(Buffer.from(bytes).equals(readFileSync(path))).toBe(true);
}

describe('accounting formats — golden files', () => {
  it('Hashavshevet: Windows-1255, tab-separated, CRLF, one balanced movement per invoice', () => {
    const f = renderAccountingFile('hashavshevet', INVOICES, CFG, PERIOD);
    golden('hashavshevet', f.bytes, 'txt');
    expect(f.rowCount).toBe(3);
    const text = new TextDecoder('windows-1255').decode(f.bytes);
    const rows = text.split('\r\n').filter(Boolean).map((l) => l.split('\t'));
    expect(rows.every((r) => r.length === 12)).toBe(true);
    for (const r of rows) {
      // Dr purchases + Dr VAT = Cr supplier, to the agora.
      expect(numericToAgorot(r[9]!)! + numericToAgorot(r[10]!)!).toBe(numericToAgorot(r[11]!));
    }
    expect(rows[0]).toEqual([
      'חס', '24118', 'BR-24118', '01/10/2026', '01/10/2026', 'מאפיית ברנר',
      '6000', '3700', '514200103', '524.14', '94.35', '618.49',
    ]);
    expect(rows[1]![5]).toBe('חד״פ מהיר בע״מ');
    expect(rows[1]![8]).toBe('S22222222'); // no company id → stable fallback card
    expect(rows[2]![8]).toBe('40015'); // explicit mapping wins
  });

  it('Priority: UTF-16LE with BOM, header (1) + line (2) records', () => {
    const f = renderAccountingFile('priority', INVOICES, CFG, PERIOD);
    golden('priority', f.bytes, 'txt');
    expect([...f.bytes.slice(0, 2)]).toEqual([0xff, 0xfe]);
    const text = new TextDecoder('utf-16le').decode(f.bytes.slice(2));
    const rows = text.split('\r\n').filter(Boolean).map((l) => l.split('\t'));
    expect(rows.map((r) => r[0])).toEqual(['1', '2', '1', '2', '1', '2']);
    expect(rows[0]).toEqual(['1', '514200103', 'BR-24118', '01/10/26', 'מאפיית ברנר', '618.49']);
    expect(rows[1]).toEqual(['2', '6000', 'RestoMatch BR-24118', '524.14', '94.35']);
  });

  it('Rivhit: UTF-8 CSV with BOM, Hebrew header row, CRLF', () => {
    const f = renderAccountingFile('rivhit', INVOICES, CFG, PERIOD);
    golden('rivhit', f.bytes, 'csv');
    expect([...f.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(f.bytes.slice(3));
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('תאריך מסמך,מספר מסמך,שם ספק,מספר עוסק,כרטיס ספק,סכום לפני מע״מ,מע״מ,סכום כולל מע״מ,כרטיס הוצאה');
    expect(lines[1]).toBe('01/10/2026,BR-24118,מאפיית ברנר,514200103,514200103,524.14,94.35,618.49,6000');
    expect(lines).toHaveLength(4);
  });

  it('an empty period renders an empty (but valid) file', () => {
    expect(renderAccountingFile('hashavshevet', [], CFG, PERIOD).bytes.length).toBe(0);
    const r = renderAccountingFile('rivhit', [], CFG, PERIOD);
    expect(new TextDecoder().decode(r.bytes.slice(3)).trim().split('\r\n')).toHaveLength(1); // header only
  });
});

describe('Rivhit CSV formula injection', () => {
  it('text cells that would run as a formula in Excel get a leading apostrophe', () => {
    const f = renderAccountingFile(
      'rivhit',
      [{ ...INVOICES[0]!, invoiceNumber: '+cmd|A-B', supplierName: '=HYPERLINK("http://evil","x")' }],
      DEFAULT_ACCOUNTING_CONFIG,
      PERIOD,
    );
    const line = new TextDecoder().decode(f.bytes.slice(3)).split('\r\n')[1]!;
    expect(line.startsWith("01/10/2026,'+cmd|A-B,\"'=HYPERLINK(")).toBe(true);
  });
});

describe('encodeWindows1255', () => {
  it('maps Hebrew letters, gershayim and ₪ to their Windows-1255 bytes', () => {
    expect([...encodeWindows1255('את')]).toEqual([0xe0, 0xfa]);
    expect([...encodeWindows1255('״₪')]).toEqual([0xd8, 0xa4]);
    expect([...encodeWindows1255('A1')]).toEqual([0x41, 0x31]);
    expect([...encodeWindows1255('😀')]).toEqual([0x3f]);
  });
  it('round-trips through the windows-1255 decoder', () => {
    const s = 'חשבונית ספק מס׳ 12 – ₪100';
    expect(new TextDecoder('windows-1255').decode(encodeWindows1255(s))).toBe(s);
  });
});

describe('numericToAgorot', () => {
  it('parses Drizzle NUMERIC strings exactly', () => {
    expect(numericToAgorot('1234.56')).toBe(123456);
    expect(numericToAgorot('0.1')).toBe(10);
    expect(numericToAgorot('5')).toBe(500);
    expect(numericToAgorot('-3.20')).toBe(-320);
    expect(numericToAgorot('1.0050')).toBe(101); // scale-4 half-up
    expect(numericToAgorot(null)).toBeNull();
    expect(numericToAgorot('abc')).toBeNull();
  });
});
