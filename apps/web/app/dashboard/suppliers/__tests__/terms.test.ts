import { describe, expect, it } from 'vitest';
import {
  businessIdProblem,
  exceedsLawLimit,
  telHref,
  termsProblem,
  termsStringOf,
  termsValueOf,
  type TermsValue,
} from '../terms';

const v = (choice: TermsValue['choice'], days = '', text = ''): TermsValue => ({ choice, days, text });

describe('W2-11 · terms picker writes the canonical strings computeDueDate parses', () => {
  it.each([
    [v('cash'), 'מזומן'],
    [v('eom'), 'שוטף'],
    [v('eom30'), 'שוטף+30'],
    [v('eom45'), 'שוטף+45'],
    [v('eom60'), 'שוטף+60'],
    [v('eom90'), 'שוטף+90'],
    [v('eomN', '75'), 'שוטף+75'],
    [v('eomN', ''), ''],
    [v('eomN', '400'), ''],
    [v('other', '', ' 30 יום מהחשבונית '), '30 יום מהחשבונית'],
    [v('none'), ''],
  ])('%j → %s', (value, out) => {
    expect(termsStringOf(value)).toBe(out);
  });

  it.each([
    ['מזומן', 'cash'],
    ['שוטף', 'eom'],
    ['שוטף + 30', 'eom30'],
    ['שוטף+60', 'eom60'],
    ['שוטף+75', 'eomN'],
    ['net 30', 'other'],
    ['', 'none'],
  ])('reads %s as %s and round-trips canonically', (raw, choice) => {
    const val = termsValueOf(raw);
    expect(val.choice).toBe(choice);
    if (choice !== 'other' && choice !== 'none') expect(termsValueOf(termsStringOf(val))).toEqual(val);
  });

  it('warns past the Payment-Delays law ceiling (שוטף+45)', () => {
    expect(exceedsLawLimit(v('eom45'))).toBe(false);
    expect(exceedsLawLimit(v('eom60'))).toBe(true);
    expect(exceedsLawLimit(v('eomN', '46'))).toBe(true);
    expect(exceedsLawLimit(v('cash'))).toBe(false);
  });

  it('blocks Save with a reason', () => {
    expect(termsProblem(v('eomN'))).toBe('pickDays');
    expect(termsProblem(v('other'))).toBe('typeTerms');
    expect(termsProblem(v('eom30'))).toBeNull();
  });
});

describe('W2-11 · ח״פ and phone', () => {
  it.each([
    ['513906578', null],
    ['51-390657-8', null],
    ['513906575', 'bizCheck'],
    ['5139065', 'bizLength'],
    ['', null],
  ])('%s → %s', (raw, out) => {
    expect(businessIdProblem(raw)).toBe(out);
  });

  it('tel: links are international', () => {
    expect(telHref('+972501234567')).toBe('tel:+972501234567');
    expect(telHref('050-123-4567')).toBe('tel:+972501234567');
  });
});
