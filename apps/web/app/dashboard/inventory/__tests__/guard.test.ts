import { describe, expect, it } from 'vitest';
import { guardFlags, guardMessageKey, lineValueAgorot } from '../count/guard';
import { classifyQty } from '../inventory-ui';
import { he } from '@/lib/i18n/messages/inventory/he';

describe('the instant guard (W2-07, foodcost-06)', () => {
  it('999 trays at ₪34 = ₪33,966 → high + value, worded with ₪ for money viewers', () => {
    const g = guardFlags({ qty: '999', expectedQty: '14', unitCost: '34.0000' });
    expect(g).toEqual({ flags: ['high', 'value'], valueAgorot: 3_396_600 });
    expect(guardMessageKey(g.flags, true, g.valueAgorot)).toBe('guardMoney');
    expect(he.count.guardMoney).toContain('{value}');
  });

  it('the chef: no unit cost on the client → ratio wording, never ₪', () => {
    const g = guardFlags({ qty: '999', expectedQty: '14' });
    expect(g).toEqual({ flags: ['high'], valueAgorot: null });
    expect(guardMessageKey(g.flags, false, null)).toBe('guardHigh');
    expect(he.count.guardHigh).not.toMatch(/₪|\{value\}/);
    expect(he.count.guardValue).not.toMatch(/₪|\{value\}/);
  });

  it("the chef's ₪2,000 check comes from the server valueFlag, only for the qty it was computed on", () => {
    expect(guardFlags({ qty: '60', expectedQty: null, serverValueFlag: true, savedQty: '60.0000' }).flags).toEqual(['value']);
    expect(guardFlags({ qty: '6', expectedQty: null, serverValueFlag: true, savedQty: '60.0000' }).flags).toEqual([]);
    expect(guardMessageKey(['value'], false, null)).toBe('guardValue');
  });

  it('thresholds: >2× high, <50 % low, >₪2,000 value; exact at the edges', () => {
    expect(guardFlags({ qty: '28', expectedQty: '14' }).flags).toEqual([]);
    expect(guardFlags({ qty: '28.0001', expectedQty: '14' }).flags).toEqual(['high']);
    expect(guardFlags({ qty: '7', expectedQty: '14' }).flags).toEqual([]);
    expect(guardFlags({ qty: '6.9999', expectedQty: '14' }).flags).toEqual(['low']);
    expect(guardFlags({ qty: '20', expectedQty: null, unitCost: '100' }).flags).toEqual([]);
    expect(guardFlags({ qty: '20.01', expectedQty: null, unitCost: '100' }).flags).toEqual(['value']);
    expect(lineValueAgorot('0.25', '12.5000')).toBe(313);
  });
});

describe('one parser for a count qty (deep-fix class 12, interim until G-13)', () => {
  it('"0,250" = 0.250 and "2,5" = 2.5; "1,250" is ambiguous and must be confirmed', () => {
    expect(classifyQty('0,250')).toEqual({ kind: 'ok', value: '0.250' });
    expect(classifyQty('2,5')).toEqual({ kind: 'ok', value: '2.5' });
    expect(classifyQty('1,250')).toEqual({ kind: 'ambiguous', options: ['1250', '1.250'] });
    expect(classifyQty('1,200,000')).toEqual({ kind: 'ok', value: '1200000' });
    expect(classifyQty('')).toEqual({ kind: 'empty' });
    expect(classifyQty('2,')).toEqual({ kind: 'typing' });
    expect(classifyQty('abc')).toEqual({ kind: 'invalid' });
  });
});
