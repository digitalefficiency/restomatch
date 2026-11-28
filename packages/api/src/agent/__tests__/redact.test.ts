import { describe, expect, it } from 'vitest';
import { canViewMoney, moneyAllowed, moneyLeaks, profileFor, redactFor } from '../redact';

/** Shapes of real procedure outputs (receiving.getPo, orders.get, owner.leakHero). */
const getPo = {
  po: { id: 'p1', supplierName: 'ירקות השרון', status: 'sent', totalEstimated: '1240.50', expectedAt: new Date('2026-10-25T06:00:00Z') },
  lines: [
    { id: 'l1', rawDescription: 'עגבניות', qtyOrdered: '12.000', unit: 'kg', unitPriceExpected: '6.2000', notes: 'מחיר מיוחד 6 ₪' },
    { id: 'l2', rawDescription: 'מלפפון', qtyOrdered: '4.000', unit: 'kg', unitPriceExpected: null, lineTotal: '30' },
  ],
};
const leakHero = { leakIls: 980, leakPct: 0.016, spendIls: 61000, caughtBeforePaymentIls: 300, invoiceCount: 12, recoveredIls: 50, deltaAgorot: 1 };

describe('redaction before the model (WA-02 §5.4)', () => {
  it('profiles and the interim money capability', () => {
    expect(profileFor('receiver')).toBe('receiver');
    expect(profileFor('chef')).toBe('chef');
    expect(profileFor('owner')).toBe('none');
    expect(canViewMoney('receiver')).toBe(false);
    expect(moneyAllowed('chef', 'orders.get')).toBe(true);
    expect(moneyAllowed('chef', 'recipes.list')).toBe(true);
    expect(moneyAllowed('chef', 'owner.leakHero')).toBe(false);
    expect(moneyAllowed('chef', 'ask.leak_hero')).toBe(false);
    expect(moneyAllowed('receiver', 'orders.get')).toBe(false);
  });

  it('receiver: no money key and no ₪ glyph survive, quantities and names do', () => {
    for (const [src, v] of [['receiving.getPo', getPo], ['owner.leakHero', leakHero], ['orders.get', getPo]] as const) {
      const out = redactFor('receiver', src, v);
      expect(moneyLeaks(out)).toEqual([]);
      expect(JSON.stringify(out)).not.toContain('₪');
      expect(JSON.stringify(out)).not.toMatch(/"[^"]*(ils|agorot|amount|total|price|cost|vat|leak|delta)[^"]*":/i);
    }
    const po = redactFor('receiver', 'receiving.getPo', getPo) as typeof getPo;
    expect(po.lines[0]).toEqual({ id: 'l1', rawDescription: 'עגבניות', qtyOrdered: '12.000', unit: 'kg' });
    expect(po.po.expectedAt).toBe('2026-10-25T06:00:00.000Z');
  });

  it('chef: orders.* keeps ₪, anything else is stripped', () => {
    const kept = redactFor('chef', 'orders.get', getPo) as typeof getPo;
    expect(kept.po.totalEstimated).toBe('1240.50');
    expect(kept.lines[0]!.unitPriceExpected).toBe('6.2000');
    expect(moneyLeaks(redactFor('chef', 'owner.leakHero', leakHero))).toEqual([]);
  });

  it('owner: nothing stripped; strings clipped and control characters removed', () => {
    const out = redactFor('owner', 'owner.leakHero', { ...leakHero, note: `a\u0000b${'x'.repeat(500)}` }) as Record<string, unknown>;
    expect(out.leakIls).toBe(980);
    expect(String(out.note).length).toBeLessThanOrEqual(201);
    expect(String(out.note)).not.toContain('\u0000');
  });

  it('a supplier name carrying ₪ or a money phrase is dropped for the receiver', () => {
    const out = redactFor('receiver', 'receiving.todayExpectations', [{ supplierName: 'ספק 500 ₪ הנחה', lineCount: 3 }]);
    expect(out).toEqual([{ lineCount: 3 }]);
  });

  it('every Hebrew spelling of a shekel amount is dropped for the receiver', () => {
    for (const v of ['42 ש״ח לק״ג', '42 ש"ח', '42 שח', '42 שקלים', '42 nis', '42 ILS', '₪42']) {
      expect(redactFor('receiver', 'receiving.getPo', { notes: v })).toEqual({});
    }
    expect(redactFor('receiver', 'receiving.getPo', { notes: 'שחור לבן' })).toEqual({ notes: 'שחור לבן' });
  });
});
