import { describe, expect, it } from 'vitest';
import { toCsv } from '../exports/csv';
import { toUniform1000Lines, type Uniform1000Invoice } from '../exports/uniform-1000';

describe('toCsv', () => {
  it('produces RFC 4180-compliant output', () => {
    const csv = toCsv(
      [{ a: 'hello', b: 42 }],
      [
        { header: 'A', value: (r) => r.a as string },
        { header: 'B', value: (r) => r.b as number },
      ],
    );
    expect(csv).toBe('A,B\nhello,42');
  });

  it('quotes fields with commas, quotes, or newlines', () => {
    const csv = toCsv(
      [{ name: 'נוסח עם פסיק, נוסף' }, { name: 'נוסח עם "ציטוט"' }],
      [{ header: 'Name', value: (r) => r.name as string }],
    );
    expect(csv).toContain('"נוסח עם פסיק, נוסף"');
    expect(csv).toContain('""ציטוט""');
  });

  it('handles null/undefined as empty', () => {
    const csv = toCsv(
      [{ a: null, b: undefined }],
      [
        { header: 'A', value: (r) => r.a as null },
        { header: 'B', value: (r) => r.b as undefined },
      ],
    );
    expect(csv).toBe('A,B\n,');
  });

  it('handles dates by ISO formatting', () => {
    const d = new Date('2026-05-21T08:00:00Z');
    const csv = toCsv([{ d }], [{ header: 'D', value: (r) => r.d as Date }]);
    expect(csv).toBe('D\n2026-05-21T08:00:00.000Z');
  });
});

describe('toUniform1000Lines (קובץ אחיד type C100)', () => {
  it('produces fixed-width 136-char lines', () => {
    const inv: Uniform1000Invoice = {
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-05-21',
      supplierBusinessId: '514778123',
      supplierName: 'ירקני אבי',
      totalExclVat: 100,
      vatAmount: 17,
      totalInclVat: 117,
    };
    const line = toUniform1000Lines([inv]);
    expect(line).toHaveLength(136);
  });

  it('zero-pads index, business id, and amounts in agorot', () => {
    const inv: Uniform1000Invoice = {
      invoiceNumber: 'X',
      invoiceDate: '2026-01-01',
      supplierBusinessId: '123',
      supplierName: 'Supplier',
      totalExclVat: 1,
      vatAmount: 0.17,
      totalInclVat: 1.17,
    };
    const line = toUniform1000Lines([inv]);
    expect(line.startsWith('C100000000001')).toBe(true);
    // business id field — index 41-49 (9 chars zero-padded)
    expect(line.slice(41, 50)).toBe('000000123');
    // totalExclVat in agorot (100), zero-padded to 12 chars — at index 100
    expect(line.slice(100, 112)).toBe('000000000100');
    // VAT in agorot (17)
    expect(line.slice(112, 124)).toBe('000000000017');
    // Total in agorot (117)
    expect(line.slice(124, 136)).toBe('000000000117');
  });

  it('joins multiple invoices with newlines and increments index', () => {
    const inv1: Uniform1000Invoice = {
      invoiceNumber: 'A',
      invoiceDate: '2026-01-01',
      supplierBusinessId: '1',
      supplierName: 'A',
      totalExclVat: 1,
      vatAmount: 0,
      totalInclVat: 1,
    };
    const inv2: Uniform1000Invoice = { ...inv1, invoiceNumber: 'B' };
    const lines = toUniform1000Lines([inv1, inv2]);
    const split = lines.split('\n');
    expect(split).toHaveLength(2);
    expect(split[0]!.slice(4, 13)).toBe('000000001');
    expect(split[1]!.slice(4, 13)).toBe('000000002');
  });

  it('truncates long supplier name to 50 chars', () => {
    const inv: Uniform1000Invoice = {
      invoiceNumber: 'X',
      invoiceDate: '2026-01-01',
      supplierBusinessId: '1',
      supplierName: 'A'.repeat(120),
      totalExclVat: 0,
      vatAmount: 0,
      totalInclVat: 0,
    };
    const line = toUniform1000Lines([inv]);
    // Field is space-padded to width 50
    expect(line.slice(50, 100)).toBe('A'.repeat(50));
  });

  it('strips non-digit characters from business id', () => {
    const inv: Uniform1000Invoice = {
      invoiceNumber: 'X',
      invoiceDate: '2026-01-01',
      supplierBusinessId: '51-477-8123',
      supplierName: 'X',
      totalExclVat: 0,
      vatAmount: 0,
      totalInclVat: 0,
    };
    const line = toUniform1000Lines([inv]);
    expect(line.slice(41, 50)).toBe('514778123');
  });
});
