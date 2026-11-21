import { describe, expect, it } from 'vitest';
import { termsCheck } from '../lib/termsCheck';

describe('termsCheck (G-17)', () => {
  it.each([
    // [label, agreed, invoiceDate, printedTerms, printedDueDate, verdict, agreedDue, printedDue]
    [
      'same terms → ok',
      'שוטף+60',
      '2026-10-15',
      'שוטף + 60',
      null,
      'ok',
      '2026-12-30',
      '2026-12-30',
    ],
    [
      'printed shorter terms',
      'שוטף+60',
      '2026-10-15',
      'שוטף+30',
      null,
      'shorter',
      '2026-12-30',
      '2026-11-30',
    ],
    [
      'printed longer terms → ok',
      'שוטף+30',
      '2026-10-15',
      'net 45',
      null,
      'ok',
      '2026-11-30',
      '2026-12-15',
    ],
    [
      'printed cash vs agreed eom → shorter',
      'שוטף+30',
      '2026-10-15',
      'מזומן',
      null,
      'shorter',
      '2026-11-30',
      '2026-10-15',
    ],
    [
      'month end: Jan 31 + שוטף+30',
      'שוטף+30',
      '2026-01-31',
      null,
      '2026-03-02',
      'ok',
      '2026-03-02',
      '2026-03-02',
    ],
    [
      'month end: one day early → shorter',
      'שוטף+30',
      '2026-01-31',
      null,
      '2026-03-01',
      'shorter',
      '2026-03-02',
      '2026-03-01',
    ],
    [
      'leap February 2028',
      'שוטף+30',
      '2028-02-10',
      'שוטף+0',
      null,
      'shorter',
      '2028-03-30',
      '2028-02-29',
    ],
    [
      'non-leap February 2027',
      'שוטף',
      '2027-02-10',
      'שוטף+0',
      null,
      'ok',
      '2027-02-28',
      '2027-02-28',
    ],
    // 22:30Z on 31.10 is 01.11 00:30 in Jerusalem (IST, UTC+2) → November invoice.
    [
      'Jerusalem midnight rolls month',
      'שוטף+30',
      '2026-10-31T22:30:00Z',
      null,
      '2026-12-30',
      'ok',
      '2026-12-30',
      '2026-12-30',
    ],
    [
      'Jerusalem midnight: a UTC-day reading would be wrong',
      'שוטף+30',
      '2026-10-31T22:30:00Z',
      null,
      '2026-12-29',
      'shorter',
      '2026-12-30',
      '2026-12-29',
    ],
    // The stated date wins over the printed terms.
    [
      'stated date earlier than printed terms → shorter',
      'שוטף+60',
      '2026-10-15',
      'שוטף+60',
      '2026-11-30',
      'shorter',
      '2026-12-30',
      '2026-11-30',
    ],
    [
      'stated date later than printed short terms → ok',
      'שוטף+60',
      '2026-10-15',
      'שוטף+30',
      '2026-12-31',
      'ok',
      '2026-12-30',
      '2026-12-31',
    ],
    [
      'agreed unknown → unknown',
      'לפי הסכם',
      '2026-10-15',
      'שוטף+30',
      null,
      'unknown',
      null,
      '2026-11-30',
    ],
    [
      'agreed missing → unknown',
      null,
      '2026-10-15',
      null,
      '2026-11-01',
      'unknown',
      null,
      '2026-11-01',
    ],
    [
      'printed missing → unknown',
      'שוטף+30',
      '2026-10-15',
      null,
      null,
      'unknown',
      '2026-11-30',
      null,
    ],
    [
      'printed unparsed → unknown',
      'שוטף+30',
      '2026-10-15',
      'ראה הסכם',
      null,
      'unknown',
      '2026-11-30',
      null,
    ],
    [
      'invoice date missing, stated date only → unknown',
      'שוטף+30',
      null,
      null,
      '2026-11-01',
      'unknown',
      null,
      '2026-11-01',
    ],
    [
      'garbage stated date falls back to printed terms',
      'שוטף+60',
      '2026-10-15',
      'שוטף+30',
      'not a date',
      'shorter',
      '2026-12-30',
      '2026-11-30',
    ],
  ] as const)('%s', (_l, agreed, inv, pTerms, pDue, verdict, agreedDue, printedDue) => {
    const r = termsCheck(agreed, inv, pTerms, pDue);
    expect(r).toMatchObject({ verdict, agreedDue, printedDue });
  });

  it('reports where the printed date came from', () => {
    expect(termsCheck('שוטף+60', '2026-10-15', 'שוטף+30', '2026-11-30').printedSource).toBe('date');
    expect(termsCheck('שוטף+60', '2026-10-15', 'שוטף+30', null).printedSource).toBe('terms');
    expect(termsCheck('שוטף+60', '2026-10-15', null, null).printedSource).toBeNull();
  });

  it('carries no money field — the flag never adds ₪', () => {
    const r = termsCheck('שוטף+60', '2026-10-15', 'שוטף+30', null);
    expect(Object.keys(r).sort()).toEqual(['agreedDue', 'printedDue', 'printedSource', 'verdict']);
  });
});
