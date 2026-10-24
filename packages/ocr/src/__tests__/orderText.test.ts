import { describe, expect, it } from 'vitest';
import { canonicalUnit, orderTextParserFromEnv, parseOrderLine, parseOrderTextDeterministic, StubOrderTextParser } from '../index';

describe('order text parser (deterministic)', () => {
  it('parses a typical Hebrew WhatsApp vegetable order', () => {
    const r = parseOrderTextDeterministic(
      [
        'שלום, הזמנה למחר בבוקר:',
        '10 ק"ג עגבניות',
        '5 ק״ג מלפפון',
        '- בצל 3 קג',
        '2 ארגזים חסה',
        'סלמון 4 קילו 89 ₪',
        'פטרוזיליה 6 צרורות',
        'תודה רבה!',
      ].join('\n'),
    );
    expect(r.supplierName).toBeNull();
    expect(r.lines).toEqual([
      { productName: 'עגבניות', qty: 10, unit: 'ק״ג', unitPrice: null },
      { productName: 'מלפפון', qty: 5, unit: 'ק״ג', unitPrice: null },
      { productName: 'בצל', qty: 3, unit: 'ק״ג', unitPrice: null },
      { productName: 'חסה', qty: 2, unit: 'ארגז', unitPrice: null },
      { productName: 'סלמון', qty: 4, unit: 'ק״ג', unitPrice: 89 },
      { productName: 'פטרוזיליה', qty: 6, unit: 'צרור', unitPrice: null },
    ]);
  });

  it('parses English orders, decimals, "@ price" and x-quantities', () => {
    const r = parseOrderTextDeterministic('To: Golan Meats\n2.5 kg beef fillet @ 120\n5 boxes lettuce\nlemons x 12\n3 units cream 14.90 nis');
    expect(r.supplierName).toBe('Golan Meats');
    expect(r.lines).toEqual([
      { productName: 'beef fillet', qty: 2.5, unit: 'ק״ג', unitPrice: 120 },
      { productName: 'lettuce', qty: 5, unit: 'ארגז', unitPrice: null },
      { productName: 'lemons', qty: 12, unit: 'יח׳', unitPrice: null },
      { productName: 'cream', qty: 3, unit: 'יח׳', unitPrice: 14.9 },
    ]);
  });

  it('reads an explicit supplier line and numbered lists', () => {
    const r = parseOrderTextDeterministic('ספק: ירקות השרון\n1. 10 ק״ג תפוחי אדמה\n2) גזר 4 ק"ג');
    expect(r.supplierName).toBe('ירקות השרון');
    expect(r.lines.map((l) => [l.productName, l.qty])).toEqual([['תפוחי אדמה', 10], ['גזר', 4]]);
  });

  it('ignores greetings, times, phone numbers and lines without an item', () => {
    for (const s of ['שלום', 'תודה!', 'עד 10:30', '050-1234567', '10 - 12', 'משלוח 25/10', 'הזמנה מספר 4521', "מס' הזמנה 778", 'Order #1234', 'טלפון 0501234567', 'בדיקה he-1366-1792823093043', 'קוד 9999999', '', '   ']) {
      expect(parseOrderLine(s), s).toBeNull();
    }
  });

  it('does not read a unit out of a word ("10 lemons" has no "l" unit)', () => {
    expect(parseOrderLine('10 lemons')).toEqual({ productName: 'lemons', qty: 10, unit: 'יח׳', unitPrice: null });
    expect(parseOrderLine('3 גרמניה')).toEqual({ productName: 'גרמניה', qty: 3, unit: 'יח׳', unitPrice: null });
  });

  it('keeps a decimal quantity at the end of the line', () => {
    expect(parseOrderLine('גבינה צהובה 1.5')).toEqual({ productName: 'גבינה צהובה', qty: 1.5, unit: 'יח׳', unitPrice: null });
  });

  it('caps the number of lines and the text length', () => {
    const big = Array.from({ length: 500 }, (_, i) => `${i + 1} ק״ג פריט`).join('\n');
    expect(parseOrderTextDeterministic(big).lines.length).toBeLessThanOrEqual(100);
  });

  it('canonicalizes units to the stored Hebrew forms', () => {
    expect(canonicalUnit('KG')).toBe('ק״ג');
    expect(canonicalUnit('יח׳')).toBe('יח׳');
    expect(canonicalUnit("יח'")).toBe('יח׳');
    expect(canonicalUnit('ק״ג')).toBe('ק״ג');
    expect(canonicalUnit('דלי')).toBe('דלי');
  });

  it('uses the stub without a key (CI has none)', async () => {
    const p = orderTextParserFromEnv({});
    expect(p.id).toBe('stub');
    expect((await new StubOrderTextParser().parseText('5 ק"ג גזר')).lines).toHaveLength(1);
  });
});
