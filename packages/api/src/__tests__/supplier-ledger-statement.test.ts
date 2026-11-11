import { describe, expect, it } from 'vitest';
import { normalizeDocNumber, reconcileStatement, type OurInvoice, type StatementLine } from '../ledger/statement';
import { kindFromType, MAX_SKIPPED_ROWS, parseStatementAmount, parseStatementCsv, parseStatementDate } from '../ledger/statementCsv';

const inv = (id: string, number: string, agorot: number, extra: Partial<OurInvoice> = {}): OurInvoice => ({
  id,
  number,
  date: '2026-10-05',
  inclVatAgorot: agorot,
  hasDeliveryNote: true,
  paid: false,
  ...extra,
});
let row = 1;
const line = (kind: StatementLine['kind'], number: string | null, amountAgorot: number, date = '2026-10-10'): StatementLine => ({
  row: ++row,
  date,
  kind,
  number,
  amountAgorot,
});

describe('reconcileStatement (W3-11 כרטסת)', () => {
  it('finds each of the six flags, agora-exact', () => {
    const r = reconcileStatement({
      lines: [
        line('invoice', '1001', 118_000, '2026-10-01'), // matched, clean
        line('invoice', '1002', 50_000), // never got
        line('invoice', '1003', 23_610), // ours 23_600: 10 agorot → within the allowance
        line('invoice', '1004', 60_000), // ours 59_000 → mismatch +1000
        line('invoice', '1005', 11_800), // no delivery note
        line('credit', 'Z-77', 5_900), // unrecorded credit (good news)
        line('payment', null, 100_000, '2026-10-31'), // we marked 1001 paid (118_000) → 18_000 unapplied
      ],
      invoices: [
        inv('i1', '1001', 118_000, { paid: true }),
        inv('i3', '1003', 23_600),
        inv('i4', '1004', 59_000),
        inv('i5', '1005', 11_800, { hasDeliveryNote: false }),
      ],
      creditNotes: [{ id: 'cn1', number: '555', issuedOn: '2026-10-15', amountAgorot: 2_000 }],
      agreedOpenAgorot: 0,
    });
    const by = (k: string) => r.flags.filter((f) => f.kind === k);
    expect(by('invoice_never_got')).toMatchObject([{ number: '1002', amountAgorot: 50_000 }]);
    expect(by('amount_mismatch')).toMatchObject([{ number: '1004', amountAgorot: 1_000, diffAgorot: 1_000, invoiceId: 'i4' }]);
    expect(by('billed_not_received')).toMatchObject([{ number: '1005', invoiceId: 'i5' }]);
    expect(by('credit_unrecorded')).toMatchObject([{ number: 'Z-77', amountAgorot: 5_900 }]);
    expect(by('credit_missing')).toMatchObject([{ creditNoteId: 'cn1', amountAgorot: 2_000 }]);
    expect(by('payment_unapplied')).toMatchObject([{ amountAgorot: 18_000 }]);
    expect(r.flags).toHaveLength(6);
    expect(r.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.totals).toEqual({ invoicedAgorot: 263_410, creditedAgorot: 5_900, paidAgorot: 100_000, otherLines: 0 });
    expect(r.matched).toEqual({ invoices: 4, credits: 0 });
  });

  it('a credit line is never netted as a payment or short-pay', () => {
    // We paid 1001 in full; the statement shows a payment short by exactly the credit.
    const r = reconcileStatement({
      lines: [line('invoice', '1001', 118_000), line('payment', null, 112_100), line('credit', '9', 5_900)],
      invoices: [inv('i1', '1001', 118_000, { paid: true })],
      creditNotes: [{ id: 'cn9', number: '9', issuedOn: '2026-10-10', amountAgorot: 5_000 }],
    });
    expect(r.matched.credits).toBe(1);
    expect(r.flags).toEqual([expect.objectContaining({ kind: 'payment_unapplied', amountAgorot: 5_900 })]);
  });

  it('matches an unnumbered credit note by amount at 18% VAT, and by number first', () => {
    const r = reconcileStatement({
      lines: [line('credit', 'X1', 11_800), line('credit', '42', 3_000)],
      invoices: [],
      creditNotes: [
        { id: 'a', number: null, issuedOn: '2026-10-10', amountAgorot: 10_000 },
        { id: 'b', number: '0042', issuedOn: '2026-10-10', amountAgorot: 9_999 },
      ],
    });
    expect(r.matched.credits).toBe(2);
    expect(r.flags).toEqual([]);
  });

  it('flags an agreed credit only when no unrecorded credit line could be it', () => {
    const base = { invoices: [], creditNotes: [], agreedOpenAgorot: 4_000 };
    expect(reconcileStatement({ ...base, lines: [line('invoice', '1', 1)] }).flags).toEqual([
      expect.objectContaining({ kind: 'invoice_never_got' }),
      expect.objectContaining({ kind: 'credit_missing', amountAgorot: 4_000 }),
    ]);
    expect(reconcileStatement({ ...base, lines: [line('credit', 'c', 4_720)] }).flags.map((f) => f.kind)).toEqual([
      'credit_unrecorded',
    ]);
  });

  it('ignores our credit notes outside the statement period; unknown receiving never flags', () => {
    const r = reconcileStatement({
      lines: [line('invoice', '7', 1_000, '2026-10-10')],
      invoices: [inv('i7', '7', 1_000, { hasDeliveryNote: null })],
      creditNotes: [{ id: 'old', number: '1', issuedOn: '2026-08-01', amountAgorot: 500 }],
    });
    expect(r.flags).toEqual([]);
  });

  it('normalizes document numbers', () => {
    expect(normalizeDocNumber('INV-00123')).toBe('123');
    expect(normalizeDocNumber(' 000 ')).toBe('0');
    expect(normalizeDocNumber('abc')).toBe('abc');
    expect(normalizeDocNumber('')).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  it('reads a Hebrew debit/credit export', () => {
    const csv = [
      'תאריך,סוג מסמך,אסמכתא,חובה,זכות',
      '01/10/2026,יתרת פתיחה,,"1,000.00",',
      '05/10/2026,חשבונית מס,1001,"1,180.00",',
      '12.10.26,חשבונית זיכוי,Z-77,,59.00',
      '31/10/2026,תשלום בהעברה,,,"1,000.00"',
      '',
      '31/10/2026,הערה,,abc,',
    ].join('\n');
    const p = parseStatementCsv(csv);
    expect(p.headerFound).toBe(true);
    expect(p.lines).toEqual([
      { row: 2, date: '2026-10-01', kind: 'other', number: null, amountAgorot: 100_000 },
      { row: 3, date: '2026-10-05', kind: 'invoice', number: '1001', amountAgorot: 118_000 },
      { row: 4, date: '2026-10-12', kind: 'credit', number: 'Z-77', amountAgorot: 5_900 },
      { row: 5, date: '2026-10-31', kind: 'payment', number: null, amountAgorot: 100_000 },
    ]);
    expect(p.skipped).toEqual([{ row: 7, reason: 'bad_amount' }]);
  });

  it('reads a signed amount column with tabs, and refuses a file without a money column', () => {
    const p = parseStatementCsv('Date\tType\tNumber\tAmount\n2026-10-03\tInvoice\t88\t₪ 250.5\n2026-10-04\tCredit note\t89\t(40)');
    expect(p.lines.map((l) => [l.kind, l.amountAgorot])).toEqual([
      ['invoice', 25_050],
      ['credit', 4_000],
    ]);
    expect(parseStatementCsv('a,b\n1,2').headerFound).toBe(false);
  });

  it('parses amounts, dates and kinds', () => {
    expect(parseStatementAmount('1,234.56')).toBe(123_456);
    expect(parseStatementAmount('80.00-')).toBe(-8_000);
    expect(parseStatementAmount('12 ש"ח')).toBe(1_200);
    expect(parseStatementAmount('x')).toBeNull();
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('7.11.26')).toBe('2026-11-07');
    expect(parseStatementDate('31/12/9999')).toBeNull();
    expect(parseStatementDate('1999-12-31')).toBeNull();
    expect(kindFromType('חשבונית זיכוי')).toBe('credit');
    expect(kindFromType("צ'ק 1234")).toBe('payment');
    expect(kindFromType('משהו')).toBeNull();
  });

  it('caps the skipped-row list', () => {
    const rows = Array.from({ length: 1_000 }, () => '01/10/2026,הערה,,abc,');
    const p = parseStatementCsv(['תאריך,סוג,אסמכתא,חובה,זכות', ...rows].join('\n'));
    expect(p.skipped).toHaveLength(MAX_SKIPPED_ROWS);
  });
});
