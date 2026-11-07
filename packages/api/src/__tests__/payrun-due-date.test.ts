import { describe, expect, it } from 'vitest';
import {
  PAYMENT_LAW_MAX_DAYS_AFTER_EOM,
  computeDueDate,
  dueBucket,
  jerusalemDayKey,
  parsePaymentTerms,
} from '../lib/dueDate';

describe('parsePaymentTerms', () => {
  it.each([
    ['שוטף+30', { kind: 'eom_plus', days: 30 }],
    ['שוטף + 30', { kind: 'eom_plus', days: 30 }],
    ['שוטף 60', { kind: 'eom_plus', days: 60 }],
    ['שוטף-45', { kind: 'eom_plus', days: 45 }],
    ['שוטף+60 יום', { kind: 'eom_plus', days: 60 }],
    ['שוטף', { kind: 'eom_plus', days: 0 }],
    ['שוטף+0', { kind: 'eom_plus', days: 0 }],
    ['net+30', { kind: 'eom_plus', days: 30 }],
    ['Net 45', { kind: 'eom_plus', days: 45 }],
    ['תנאי תשלום: שוטף + 60', { kind: 'eom_plus', days: 60 }],
    ['  שוטף   +   90  ', { kind: 'eom_plus', days: 90 }],
    ['מזומן', { kind: 'cash' }],
    ['cash', { kind: 'cash' }],
  ] as const)('%s', (text, expected) => {
    expect(parsePaymentTerms(text)).toEqual(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['30 יום'],
    ['לפי הסכם'],
    ['שוטף+abc'],
    ['שוטף+9999'],
    ['x'.repeat(501)],
    ['שוטף+30 '.repeat(80)],
  ])('unknown: %s', (text) => {
    expect(parsePaymentTerms(text as string | null | undefined)).toEqual({ kind: 'unknown' });
  });
});

describe('computeDueDate', () => {
  it.each([
    // owner example: 28.09 + שוטף+30 → 30.10
    ['2026-09-28', 'שוטף+30', '2026-10-30'],
    ['2026-09-28', 'שוטף + 30', '2026-10-30'],
    ['2026-09-28', 'שוטף+0', '2026-09-30'],
    ['2026-09-28', 'שוטף+45', '2026-11-14'],
    ['2026-09-28', 'שוטף+60', '2026-11-29'],
    // month ends
    ['2026-01-31', 'שוטף+30', '2026-03-02'],
    ['2026-12-31', 'שוטף+30', '2027-01-30'],
    ['2026-10-01', 'שוטף+0', '2026-10-31'],
    // February, common and leap
    ['2026-02-10', 'שוטף+0', '2026-02-28'],
    ['2028-02-10', 'שוטף+0', '2028-02-29'],
    ['2028-02-29', 'שוטף+30', '2028-03-30'],
    ['2028-01-15', 'שוטף+30', '2028-03-01'],
    // cash = the invoice day
    ['2026-10-25', 'מזומן', '2026-10-25'],
  ])('%s + %s → %s', (inv, terms, due) => {
    const r = computeDueDate(inv, terms);
    expect(r).toMatchObject({ dueDate: due, source: 'agreed' });
  });

  it('Asia/Jerusalem midnight: 30.09 21:30Z is an Israeli 01.10 invoice', () => {
    // 2026-09-30T21:30Z = 01.10 00:30 IDT (UTC+3)
    const r = computeDueDate(new Date('2026-09-30T21:30:00Z'), 'שוטף+0');
    expect(r.dueDate).toBe('2026-10-31');
    // 2026-09-30T20:59Z = 30.09 23:59 IDT → stays September
    expect(computeDueDate(new Date('2026-09-30T20:59:00Z'), 'שוטף+0').dueDate).toBe('2026-09-30');
  });

  it('Asia/Jerusalem midnight in winter (UTC+2) and on the DST fall-back night', () => {
    // 2026-11-30T22:30Z = 01.12 00:30 IST
    expect(computeDueDate(new Date('2026-11-30T22:30:00Z'), 'מזומן').dueDate).toBe('2026-12-01');
    // 2026-10-25 is the fall-back Sunday; 21:00Z on 24.10 is 00:00 local on 25.10
    expect(jerusalemDayKey(new Date('2026-10-24T21:00:00Z'))).toBe('2026-10-25');
  });

  it('an explicit (human) due date wins over agreed and printed', () => {
    const r = computeDueDate('2026-09-28', 'שוטף+30', '2026-10-05', {
      printedDueDate: '2026-10-01',
    });
    expect(r).toMatchObject({ dueDate: '2026-10-05', source: 'explicit' });
    expect(r.terms).toEqual({ kind: 'eom_plus', days: 30 });
  });

  it('agreed terms win over a printed (earlier) due date', () => {
    const r = computeDueDate('2026-09-28', 'שוטף+60', null, { printedDueDate: '2026-10-30' });
    expect(r).toMatchObject({ dueDate: '2026-11-29', source: 'agreed' });
  });

  it('the printed due date is used only when there are no agreed terms', () => {
    const r = computeDueDate('2026-09-28', null, null, { printedDueDate: '2026-10-30' });
    expect(r).toMatchObject({ dueDate: '2026-10-30', source: 'printed' });
  });

  it('unknown terms with nothing else → unknown, never throws', () => {
    expect(computeDueDate('2026-09-28', 'לפי סיכום')).toMatchObject({
      dueDate: null,
      source: 'unknown',
    });
    expect(computeDueDate(null, 'שוטף+30')).toMatchObject({ dueDate: null, source: 'unknown' });
    expect(computeDueDate('garbage', 'שוטף+30')).toMatchObject({
      dueDate: null,
      source: 'unknown',
    });
    expect(computeDueDate('2026-02-30', 'שוטף+30').dueDate).toBeNull();
  });

  it('flags terms beyond the Payment-Delays law ceiling', () => {
    expect(PAYMENT_LAW_MAX_DAYS_AFTER_EOM).toBe(45);
    expect(computeDueDate('2026-09-28', 'שוטף+45').exceedsLawLimit).toBe(false);
    expect(computeDueDate('2026-09-28', 'שוטף+60').exceedsLawLimit).toBe(true);
    expect(computeDueDate('2026-09-28', 'שוטף+90', '2026-10-01').exceedsLawLimit).toBe(true);
    expect(computeDueDate('2026-09-28', 'מזומן').exceedsLawLimit).toBe(false);
  });
});

describe('dueBucket', () => {
  // 25.10.2026 is a Sunday
  const today = '2026-10-25';
  it.each([
    ['2026-10-24', 'overdue'],
    ['2026-10-25', 'this_week'],
    ['2026-10-28', 'this_week'], // MF-24950 lab row
    ['2026-10-31', 'this_week'],
    ['2026-11-01', 'next_week'],
    ['2026-11-07', 'next_week'],
    ['2026-11-08', 'later'],
    [null, 'unknown'],
  ] as const)('%s → %s', (due, bucket) => {
    expect(dueBucket(due, today)).toBe(bucket);
  });

  it('on a Saturday, השבוע is only today', () => {
    expect(dueBucket('2026-10-31', '2026-10-31')).toBe('this_week');
    expect(dueBucket('2026-11-01', '2026-10-31')).toBe('next_week');
  });
});
