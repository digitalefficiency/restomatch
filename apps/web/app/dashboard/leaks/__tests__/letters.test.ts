import { describe, expect, it } from 'vitest';
import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';
import { activeMembershipOf } from '@/lib/activeRestaurant';
import { formatIls } from '@/lib/money';
import { approvedNotClaimed, buildLetters, daysLeft, letterAgorotFor, lettersFromServer, lineMath, sumAgora, type ServerLetter, type TrackedClaim } from '../claims/letters';
import { lineMathText } from '../claims/why';
import { leakStateOf, zeroNoteOf } from '../states';

const line = (over: Partial<LeakBreakdownLine> = {}): LeakBreakdownLine => ({
  discrepancyId: over.discrepancyId ?? `d-${Math.random()}`,
  type: 'PRICE_HIGHER',
  severity: 'warn',
  // Decided (approved to claim) unless a test says otherwise — only decided lines reach a letter.
  resolutionStatus: 'accepted',
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
  discrepancyId: over.discrepancyId ?? `d-${Math.random()}`,
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

  it('never prints a tracked line twice: a claimed month line is the CLAIM’s line, before payment while unpaid', () => {
    const inv = invoice({ invoiceId: 'inv-a', lines: [line({ discrepancyId: 'd-a' })] });
    const c = claim({ discrepancyId: 'd-a', invoiceId: 'inv-a', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט', outstandingAgorot: 10000 });
    const { letters } = buildLetters({ month: [inv], tracked: [c] });
    expect(letters[0]!.beforePayment).toHaveLength(1);
    expect(letters[0]!.forCredit).toHaveLength(0);
    expect(letters[0]!.beforePayment[0]!.claimId).toBe(c.id);
    expect(letters[0]!.beforePayment[0]!.key).toBe(c.id);
    expect(letters[0]!.total).toBe(100);
  });

  it('dedupes by discrepancy id: a line with ANY live claim is never a month line — a written-off claim gives it back', () => {
    const inv = invoice({ invoiceId: 'inv-a', lines: [line({ discrepancyId: 'd-a' })] });
    for (const status of ['acknowledged', 'credited', 'disputed', 'recovered']) {
      const { letters } = buildLetters({ month: [inv], tracked: [claim({ discrepancyId: 'd-a', status, outstandingAgorot: 10000 })] });
      expect(letters, status).toHaveLength(0);
    }
    const back = buildLetters({ month: [inv], tracked: [claim({ discrepancyId: 'd-a', status: 'written_off', outstandingAgorot: 0 })] });
    expect(back.letters[0]!.beforePayment.map((l) => l.key)).toEqual(['d-a']);
  });

  it('undecided lines (open / escalated) are never addressed to a supplier — they come back as a "decide" count', () => {
    const inv = invoice({
      invoiceId: 'inv-a',
      leakIls: 160,
      lines: [
        line({ discrepancyId: 'o', resolutionStatus: 'open', deltaAmount: 50 }),
        line({ discrepancyId: 'e', resolutionStatus: 'escalated', deltaAmount: 10 }),
        line({ discrepancyId: 'a', resolutionStatus: 'accepted', deltaAmount: 100 }),
      ],
    });
    const { letters, undecided } = buildLetters({ month: [inv], tracked: [] });
    expect(letters[0]!.beforePayment.map((l) => l.key)).toEqual(['a']);
    expect(undecided.count).toBe(2);
    expect(undecided.amount).toBe(60);
    expect(undecided.bySupplier.get('קצביית הכרם')).toEqual({ count: 2, amount: 60 });
  });

  it('a month line whose claim already went out (letter_sent …) leaves the letter and shows as sent', () => {
    const inv = invoice({ invoiceId: 'inv-a', lines: [line({ discrepancyId: 'd-a' })] });
    const c = claim({
      discrepancyId: 'd-a',
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
      lines: [line({ discrepancyId: 'd-k', type: 'QTY_OVER', severity: 'block', productName: 'כתף', expected: 10, actual: 12, deltaAmount: 131.32 })],
    });
    const { letters } = buildLetters({ month: [], tracked: [claim({ discrepancyId: 'd-k' })], history: [hist] });
    const l = letters[0]!.forCredit[0]!;
    expect(l.invoiceDate).toBe('2026-09-02T10:00:00.000Z');
    expect(lineMath(l)).toEqual({ kind: 'qty', billed: 12, received: 10, unitPrice: 65.66 });
  });

  it('pairs a claim with ITS line by discrepancy id — two lines of one product on one invoice never swap', () => {
    // Two PRICE_HIGHER lines for the same product on one invoice; the FIRST one's claim already went out.
    const inv = invoice({
      invoiceId: 'inv-a',
      leakIls: 300,
      lines: [
        line({ discrepancyId: 'd-1', deltaAmount: 100 }),
        line({ discrepancyId: 'd-2', deltaAmount: 200, expected: 139, actual: 159 }),
      ],
    });
    const sentClaim = claim({
      discrepancyId: 'd-1',
      invoiceId: 'inv-a',
      discrepancyType: 'PRICE_HIGHER',
      productName: 'אנטריקוט',
      status: 'letter_sent',
      letterSentAt: '2026-10-25T09:00:00.000Z',
      outstandingAgorot: 10000,
    });
    const openClaim = claim({ discrepancyId: 'd-2', invoiceId: 'inv-a', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט', outstandingAgorot: 20000 });
    const { letters } = buildLetters({ month: [inv], tracked: [sentClaim, openClaim] });
    expect(letters).toHaveLength(1);
    expect(letters[0]!.beforePayment.map((l) => [l.key, l.claimId, l.amount])).toEqual([[openClaim.id, openClaim.id, 200]]);
    expect(letters[0]!.forCredit).toHaveLength(0);
    expect(letters[0]!.claimIds).toEqual([openClaim.id]);
  });

  it('carries the engine severity onto the line (it tells the QTY_OVER shapes apart)', () => {
    const { letters } = buildLetters({ month: [invoice({ lines: [line({ severity: 'block' })] })], tracked: [] });
    expect(letters[0]!.beforePayment[0]!.severity).toBe('block');
  });
});

describe('the ₪ basis of a line (expected vs charged)', () => {
  it('PRICE_HIGHER: billed qty × charged · expected price (the order’s OR the usual p90 — never claims "on the order")', () => {
    expect(lineMath({ type: 'PRICE_HIGHER', expected: 139, actual: 149, deltaAmount: 100 })).toEqual({
      kind: 'price',
      qty: 10,
      charged: 149,
      expected: 139,
    });
    const he = (v: number) => formatIls(v, { locale: 'he', maximumFractionDigits: 2 });
    expect(lineMathText({ type: 'PRICE_HIGHER', expected: 139, actual: 149, deltaAmount: 100 }, 'he')).toBe(
      `חויב 10 × ${he(149)} · מחיר צפוי ${he(139)}`,
    );
    expect(lineMathText({ type: 'PRICE_HIGHER', expected: 89, actual: 96, deltaAmount: 52.5 }, 'en')).toBe(
      'Billed 7.5 × ₪96.00 · expected price ₪89.00',
    );
    expect(lineMathText({ type: 'PRICE_HIGHER', expected: 139, actual: 149, deltaAmount: 100 }, 'he')).not.toContain('בהזמנה');
  });
  it('QTY_OVER: only the block shape is "billed vs received"; the warn/info shape is "ordered vs received"', () => {
    // 5b block: expected = received, actual = billed.
    expect(lineMath({ type: 'QTY_OVER', severity: 'block', expected: 10, actual: 12, deltaAmount: 131.32 })).toEqual({
      kind: 'qty',
      billed: 12,
      received: 10,
      unitPrice: 65.66,
    });
    // 5a warn: expected = ordered, actual = received — nothing was "billed" here.
    expect(lineMath({ type: 'QTY_OVER', severity: 'warn', expected: 10, actual: 14, deltaAmount: 200 })).toEqual({
      kind: 'qtyReceived',
      ordered: 10,
      received: 14,
      unitPrice: 50,
    });
    const text = lineMathText({ type: 'QTY_OVER', severity: 'warn', expected: 10, actual: 14, deltaAmount: 200 }, 'he')!;
    expect(text).toContain('הוזמנו 10');
    expect(text).not.toContain('חויב');
    // Unknown shape → no basis line rather than a false one.
    expect(lineMath({ type: 'QTY_OVER', expected: 10, actual: 12, deltaAmount: 131.32 })).toBeNull();
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
    const held = [claim({ discrepancyId: 'p', invoiceId: 'gd', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט' })];
    const gap = approvedNotClaimed([inv], held);
    expect(gap.map((g) => g.line.discrepancyId)).toEqual(['vat']);
  });
  it('matches on the discrepancy id: a claim on one same-product line never covers its twin', () => {
    const inv = invoice({
      invoiceId: 'gd',
      lines: [line({ discrepancyId: 'p1', resolutionStatus: 'accepted' }), line({ discrepancyId: 'p2', resolutionStatus: 'accepted' })],
    });
    const gap = approvedNotClaimed([inv], [claim({ discrepancyId: 'p2', invoiceId: 'gd', discrepancyType: 'PRICE_HIGHER', productName: 'אנטריקוט' })]);
    expect(gap.map((g) => g.line.discrepancyId)).toEqual(['p1']);
  });
});

describe('owner terminology (פער, never the retired הפרשים)', () => {
  it('the supplier letter subject and intro say פערים', async () => {
    const { he } = await import('@/lib/i18n/messages/leaks/he');
    expect(he.claims.subject).toContain('פערים');
    expect(he.claims.intro).toContain('פערים');
    expect(JSON.stringify(he)).not.toMatch(/הפרש/);
  });
});

describe('the supplier card CTA promises the letter’s ₪ (not the 90-day open total)', () => {
  it('is the total of that supplier’s letter — this month’s unpaid lines + its unsent claims', () => {
    const { letters } = buildLetters({
      month: [
        invoice({ invoiceId: 'a', lines: [line({ deltaAmount: 100 })] }),
        invoice({ invoiceId: 'b', supplierName: 'ירקות השרון', lines: [line({ deltaAmount: 7 })] }),
      ],
      tracked: [claim()],
    });
    // By name when the month line carries no supplier id; by id when the letter has one.
    expect(letterAgorotFor(letters, { id: 'sup-x', name: 'ירקות השרון' })).toBe(700);
    expect(letterAgorotFor(letters, { id: 'sup-1', name: null })).toBe(23132);
    expect(letterAgorotFor(letters, { id: 'nobody', name: 'אין' })).toBe(0);
  });
});

describe('a ₪0 line says why only when the engine proves it', () => {
  it('QTY_SHORT zeroed because the shortfall WAS billed → points at the QTY_OVER block line (never "you were not billed")', () => {
    const short = line({ discrepancyId: 's', type: 'QTY_SHORT', severity: 'warn', deltaAmount: 0, poLineId: 'po-1' });
    const over = line({ discrepancyId: 'o', type: 'QTY_OVER', severity: 'block', deltaAmount: 131.32, poLineId: 'po-1' });
    expect(zeroNoteOf(short, [short, over])).toBe('billedShort');
  });
  it('a ₪0 QTY_SHORT with no billed-over line (e.g. no unit price) is just "no money impact"', () => {
    const short = line({ discrepancyId: 's', type: 'QTY_SHORT', severity: 'warn', deltaAmount: 0, poLineId: 'po-1' });
    const otherPo = line({ discrepancyId: 'o', type: 'QTY_OVER', severity: 'block', deltaAmount: 50, poLineId: 'po-2' });
    expect(zeroNoteOf(short, [short, otherPo])).toBe('none');
    expect(zeroNoteOf(short, [short])).toBe('none');
  });
  it('the billed-short note never claims "not billed"', async () => {
    const { he } = await import('@/lib/i18n/messages/leaks/he');
    expect(he.breakdown.noMoneyShort).not.toMatch(/לא חויבתם/);
  });
});

describe('W2-10: letters from recovery.letters only', () => {
  const line = (claimId: string, amountAgorot: number): ServerLetter['beforePayment'][number] => ({
    claimId,
    discrepancyId: `d-${claimId}`,
    invoiceId: 'i1',
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-10-10T00:00:00.000Z',
    type: 'PRICE_HIGHER',
    severity: 'warn',
    productName: 'עגבניות',
    productNameEn: null,
    lineDescription: null,
    lineDescriptionEn: null,
    amountAgorot,
    basis: 'excl',
    expected: 10,
    actual: 12,
    deltaAmount: 20,
  });
  it('keeps the two sections, sums to the agora and never adds a line the server did not send', () => {
    const server: ServerLetter[] = [
      { supplierId: 's1', supplierName: 'ספק', supplierNameEn: null, beforePayment: [line('c1', 3333)], forCredit: [line('c2', 1)], claimIds: ['c1', 'c2'] },
    ];
    const { letters } = lettersFromServer(server, []);
    expect(letters).toHaveLength(1);
    const [l] = letters;
    expect(l!.beforePayment.map((x) => x.claimId)).toEqual(['c1']);
    expect(l!.forCredit.map((x) => x.claimId)).toEqual(['c2']);
    expect(l!.beforePaymentTotal).toBe(33.33);
    expect(l!.forCreditTotal).toBe(0.01);
    expect(Math.round(l!.total * 100)).toBe(3334);
    expect(l!.claimIds).toEqual(['c1', 'c2']);
  });
  it('an empty server answer is no letter — undecided month lines are never letters (decision 18)', () => {
    expect(lettersFromServer([], []).letters).toEqual([]);
  });
});
