import { describe, expect, it } from 'vitest';
import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { activeMembershipOf } from '@/lib/activeRestaurant';
import { formatIls } from '@/lib/money';
import { approvedNotClaimed, buildLetters, daysLeft, lineMath, sumAgora, type TrackedClaim } from '../claims/letters';
import { lineMathText } from '../claims/why';
import { leakStateOf } from '../states';

const line = (over: Partial<LeakBreakdownLine> = {}): LeakBreakdownLine => ({
  discrepancyId: over.discrepancyId ?? `d-${Math.random()}`,
  type: 'PRICE_HIGHER',
  severity: 'warn',
  resolutionStatus: 'open',
  deltaAmount: 100,
  expected: 139,
  actual: 149,
  countsAsLeak: true,
  productName: 'אנטריקוט',
  productNameEn: 'Entrecote',
  lineDescription: null,
  lineDescriptionEn: null,
  poLineId: null,
  invoiceLineId: null,
  productId: null,
  ...over,
});
const invoice = (over: Partial<LeakBreakdownInvoice> = {}): LeakBreakdownInvoice => ({
  invoiceId: over.invoiceId ?? `inv-${Math.random()}`,
  invoiceNumber: 'HK-1',
  invoiceDate: '2026-10-20T10:00:00.000Z',
  status: 'received',
  supplierName: 'קצביית הכרם',
  supplierNameEn: 'HaKerem Butchery',
  totalInclVat: 5000,
  leakIls: 100,
  pendingLink: false,
  lines: [line()],
  ...over,
});
const claim = (over: Partial<TrackedClaim> = {}): TrackedClaim => ({
  id: over.id ?? `c-${Math.random()}`,
  status: 'claimed',
  outstandingAgorot: 13132,
  supplierId: 'sup-1',
  supplierName: 'קצביית הכרם',
  supplierNameEn: 'HaKerem Butchery',
  invoiceId: 'inv-paid',
  invoiceNumber: 'HK-0',
  discrepancyType: 'QTY_OVER',
  productName: 'כתף',
  productNameEn: null,
  lineDescription: null,
  lineDescriptionEn: null,
  claimedAt: '2026-10-10T08:00:00.000Z',
  letterSentAt: null,
  ...over,
});

describe('claim letters: one per supplier (leaks-07)', () => {
  it('merges the before-payment lines and the tracker claims of one supplier into ONE letter with one total', () => {
    const { letters } = buildLetters({ month: [invoice({ invoiceId: 'inv-a' })], tracked: [claim()] });
    expect(letters).toHaveLength(1);
    const [l] = letters;
    expect(l!.beforePayment).toHaveLength(1);
    expect(l!.forCredit).toHaveLength(1);
    expect(l!.beforePaymentTotal).toBe(100);
    expect(l!.forCreditTotal).toBe(131.32);
    expect(l!.total).toBe(231.32);
    expect(l!.supplierId).toBe('sup-1');
    expect(l!.claimIds).toHaveLength(1);
  });

  it('never prints a tracked line twice: a claimed month line stays before payment and carries its claim', () => {
    const inv = invoice({ invoiceId: 'inv-a' });
    const c = claim({ invoiceId: 'inv-a', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט', outstandingAgorot: 10000 });
    const { letters } = buildLetters({ month: [inv], tracked: [c] });
    expect(letters[0]!.beforePayment).toHaveLength(1);
    expect(letters[0]!.forCredit).toHaveLength(0);
    expect(letters[0]!.beforePayment[0]!.claimId).toBe(c.id);
    expect(letters[0]!.total).toBe(100);
  });

  it('a month line whose claim already went out (letter_sent …) leaves the letter and shows as sent', () => {
    const inv = invoice({ invoiceId: 'inv-a' });
    const c = claim({
      invoiceId: 'inv-a',
      discrepancyType: 'PRICE_HIGHER',
      productName: 'אנטריקוט',
      status: 'letter_sent',
      letterSentAt: '2026-10-25T09:00:00.000Z',
      outstandingAgorot: 10000,
    });
    const { letters, sent } = buildLetters({ month: [inv], tracked: [c] });
    expect(letters).toHaveLength(0);
    expect(sent).toEqual([expect.objectContaining({ supplierName: 'קצביית הכרם', count: 1, outstandingAgorot: 10000 })]);
  });

  it('separate suppliers get separate letters, largest first; totals add to the agora', () => {
    const { letters } = buildLetters({
      month: [
        invoice({ invoiceId: 'a', leakIls: 0.1, lines: [line({ deltaAmount: 0.1 })] }),
        invoice({ invoiceId: 'b', supplierName: 'ירקות השרון', leakIls: 0.2, lines: [line({ deltaAmount: 0.2 })] }),
      ],
      tracked: [],
    });
    expect(letters.map((l) => l.supplierName)).toEqual(['ירקות השרון', 'קצביית הכרם']);
    expect(sumAgora(letters.map((l) => l.total))).toBe(0.3);
  });

  it('paid invoices have nothing before payment; the tracker claim on them is for credit', () => {
    const { letters } = buildLetters({ month: [invoice({ status: 'paid' })], tracked: [claim()] });
    expect(letters[0]!.beforePayment).toHaveLength(0);
    expect(letters[0]!.forCredit).toHaveLength(1);
  });

  it('adds the invoice date and the ₪ basis to a tracker line from the breakdown history', () => {
    const hist = invoice({
      invoiceId: 'inv-paid',
      invoiceDate: '2026-09-02T10:00:00.000Z',
      status: 'paid',
      lines: [line({ type: 'QTY_OVER', productName: 'כתף', expected: 10, actual: 12, deltaAmount: 131.32 })],
    });
    const { letters } = buildLetters({ month: [], tracked: [claim()], history: [hist] });
    const l = letters[0]!.forCredit[0]!;
    expect(l.invoiceDate).toBe('2026-09-02T10:00:00.000Z');
    expect(lineMath(l)).toEqual({ kind: 'qty', billed: 12, received: 10, unitPrice: 65.66 });
  });
});

describe('the ₪ basis of a line (expected vs charged)', () => {
  it('PRICE_HIGHER: billed qty × charged · ordered price', () => {
    expect(lineMath({ type: 'PRICE_HIGHER', expected: 139, actual: 149, deltaAmount: 100 })).toEqual({
      kind: 'price',
      qty: 10,
      charged: 149,
      ordered: 139,
    });
    const he = (v: number) => formatIls(v, { locale: 'he', maximumFractionDigits: 2 });
    expect(lineMathText({ type: 'PRICE_HIGHER', expected: 139, actual: 149, deltaAmount: 100 }, 'he')).toBe(
      `חויב 10 × ${he(149)} · בהזמנה ${he(139)}`,
    );
    expect(lineMathText({ type: 'PRICE_HIGHER', expected: 89, actual: 96, deltaAmount: 52.5 }, 'en')).toBe(
      'Billed 7.5 × ₪96.00 · ordered at ₪89.00',
    );
  });
  it('VAT and total mismatches show both sides; no basis → null (never a made-up number)', () => {
    expect(lineMath({ type: 'VAT_MISMATCH', expected: 180, actual: 192.66, deltaAmount: 12.66 })).toEqual({
      kind: 'vat',
      charged: 192.66,
      expected: 180,
    });
    expect(lineMath({ type: 'PRICE_HIGHER', expected: null, actual: 149, deltaAmount: 100 })).toBeNull();
    expect(lineMath({ type: 'DUPLICATE_INVOICE', expected: null, actual: null, deltaAmount: 500 })).toBeNull();
  });
});

describe('the sender is the ACTIVE restaurant (leaks-01)', () => {
  const rows = [
    { restaurantId: 'r-1', restaurantName: 'כפר הזיתים — חיפה' },
    { restaurantId: 'r-2', restaurantName: 'כפר הזיתים' },
  ];
  it('two memberships, the second active → the second, never memberships[0]', () => {
    expect(activeMembershipOf(rows, 'r-2')?.restaurantName).toBe('כפר הזיתים');
    expect(activeMembershipOf([...rows].reverse(), 'r-2')?.restaurantName).toBe('כפר הזיתים');
  });
  it('unknown or missing active restaurant → undefined (no fallback to another branch)', () => {
    expect(activeMembershipOf(rows, 'r-9')).toBeUndefined();
    expect(activeMembershipOf(rows, null)).toBeUndefined();
  });
});

describe('the three leak states (leaks-18)', () => {
  it('no checked invoice → noData (never ₪0); clean → clean; money → leak', () => {
    expect(leakStateOf({ matchedInvoiceCount: 0, leakIls: 0 })).toBe('noData');
    expect(leakStateOf({ matchedInvoiceCount: 35, leakIls: 0 })).toBe('clean');
    expect(leakStateOf({ matchedInvoiceCount: 35, leakIls: 759.54 })).toBe('leak');
  });
});

describe('reply-by countdown', () => {
  it('counts Israel calendar days left from the send date', () => {
    expect(daysLeft('2026-10-25T09:00:00.000Z', 14, '2026-10-25T20:00:00.000Z')).toBe(14);
    expect(daysLeft('2026-10-11T09:00:00.000Z', 14, '2026-10-25T09:00:00.000Z')).toBe(0);
    expect(daysLeft('2026-10-01T09:00:00.000Z', 14, '2026-10-25T09:00:00.000Z')).toBe(-10);
  });
});

describe('approved to claim but held by no ₪-back claim (leaks-03 gap)', () => {
  it('names only the approved lines no claim holds', () => {
    const inv = invoice({
      invoiceId: 'gd',
      supplierName: 'מחלבות הגליל',
      lines: [
        line({ discrepancyId: 'vat', type: 'VAT_MISMATCH', productName: null, resolutionStatus: 'resolved', deltaAmount: 12.66 }),
        line({ discrepancyId: 'p', resolutionStatus: 'accepted' }),
        line({ discrepancyId: 'o', resolutionStatus: 'open' }),
      ],
    });
    const held = [claim({ invoiceId: 'gd', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט' })];
    const gap = approvedNotClaimed([inv], held);
    expect(gap.map((g) => g.line.discrepancyId)).toEqual(['vat']);
  });
});
