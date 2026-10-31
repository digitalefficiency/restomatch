import { describe, expect, it } from 'vitest';
import { poRefOf as serverPoRefOf } from '../../../../../../packages/api/src/orders/supplierMessage';
import {
  cancelNoticeText,
  mailtoLink,
  matchesOrderSearch,
  parsePriceInput,
  poRefOf,
  reorderLines,
  unpricedCount,
  waLink,
  waPhone,
} from '../order-logic';
import { addDays, localNow, nextDeliveryOptions, weekdayOf } from '../new/delivery-days';
import { en as ordersEn } from '../../../../lib/i18n/messages/orders/en';
import { he as ordersHe } from '../../../../lib/i18n/messages/orders/he';
import {
  emptyCart,
  pairServerLines,
  parseStore,
  planDraftSync,
  withCart,
  type Cart,
  type CartLine,
  type ServerLine,
} from '../new/draft-store';

const TZ = 'Asia/Jerusalem';
const PO = 'f8e05686-1234-4abc-9def-001122334455';

describe('poRefOf', () => {
  it('is the ref the supplier receives (parity with the server)', () => {
    expect(poRefOf(PO)).toBe('F8E05686');
    expect(poRefOf(PO)).toBe(serverPoRefOf(PO));
  });
});

describe('matchesOrderSearch', () => {
  const o = { id: PO, supplierName: 'ירקות השרון', supplierNameEn: 'Sharon Veg' };
  it('finds by ref with or without # and in any case', () => {
    expect(matchesOrderSearch(o, '#F8E05686')).toBe(true);
    expect(matchesOrderSearch(o, 'f8e0')).toBe(true);
    expect(matchesOrderSearch(o, '#AAAA')).toBe(false);
  });
  it('finds by Hebrew or English supplier name; empty matches all', () => {
    expect(matchesOrderSearch(o, 'השרון')).toBe(true);
    expect(matchesOrderSearch(o, 'sharon')).toBe(true);
    expect(matchesOrderSearch(o, '  ')).toBe(true);
    expect(matchesOrderSearch(o, 'מאפייה')).toBe(false);
  });
});

describe('unpricedCount', () => {
  it('counts lines with no price (null, undefined or empty), not ₪0 lines', () => {
    expect(unpricedCount([{ unitPriceExpected: 0 }, { unitPriceExpected: null }, {}, { unitPriceExpected: '' }])).toBe(3);
  });
});

describe('wa.me / mailto links', () => {
  it('normalises an Israeli number to 972…', () => {
    expect(waPhone('050-123 4567')).toBe('972501234567');
    expect(waPhone('+972 50 1234567')).toBe('972501234567');
    expect(waPhone('12')).toBeNull();
    expect(waLink('0501234567', 'שלום')).toBe(`https://wa.me/972501234567?text=${encodeURIComponent('שלום')}`);
    expect(waLink(null, 'x')).toBe('https://wa.me/?text=x');
  });
  it('mailto encodes subject and body', () => {
    expect(mailtoLink('a@b.co', 'ביטול', 'שורה\nשנייה')).toBe(
      `mailto:a@b.co?subject=${encodeURIComponent('ביטול')}&body=${encodeURIComponent('שורה\nשנייה')}`,
    );
  });
});

describe('cancelNoticeText', () => {
  it('names the ref, the delivery day and the restaurant', () => {
    const { subject, body } = cancelNoticeText({
      supplierName: 'ירקות השרון',
      poRef: 'F8E05686',
      deliveryLabel: 'ג׳ 27.10',
      restaurantName: 'כפר הזיתים',
    });
    expect(subject).toBe('ביטול הזמנה F8E05686');
    expect(body).toContain('F8E05686');
    expect(body).toContain('אספקה ג׳ 27.10');
    expect(body).toContain('כפר הזיתים');
  });
});

describe('reorderLines', () => {
  const src = [
    { productId: 'p-tomato', rawDescription: 'עגבניות', qtyOrdered: '10.000', unit: 'ק״ג', unitPriceExpected: '6.50' },
    { productId: 'p-cucumber', rawDescription: 'מלפפונים', qtyOrdered: '5', unit: 'ק״ג', unitPriceExpected: '4.00' },
    { productId: 'p-gone', rawDescription: 'חסה אייסברג', qtyOrdered: '3', unit: 'יח׳', unitPriceExpected: '5.00' },
    { productId: null, rawDescription: 'ארגז נענע', qtyOrdered: '1', unit: 'ארגז', unitPriceExpected: '25' },
    { productId: null, rawDescription: '  ', qtyOrdered: '1', unit: 'יח׳', unitPriceExpected: null },
  ];
  const catalog = [
    { productId: 'p-tomato', listPrice: '7.10', unit: 'ק״ג' },
    { productId: 'p-cucumber', listPrice: null, unit: 'ק״ג' },
  ];
  const contract = (id: string) => (id === 'p-tomato' ? 6.9 : undefined);

  it('prices at contract, else catalog, else last; copies free lines; lists what the supplier dropped', () => {
    const r = reorderLines(src, catalog, contract);
    expect(r.unavailable).toEqual(['חסה אייסברג']);
    expect(r.lines).toEqual([
      { productId: 'p-tomato', rawDescription: 'עגבניות', qty: 10, unit: 'ק״ג', unitPriceExpected: 6.9, priceSource: 'contract' },
      { productId: 'p-cucumber', rawDescription: 'מלפפונים', qty: 5, unit: 'ק״ג', unitPriceExpected: 4, priceSource: 'last' },
      { rawDescription: 'ארגז נענע', qty: 1, unit: 'ארגז', unitPriceExpected: 25, priceSource: 'last' },
    ]);
  });

  it('without contracts the catalog list price wins over the last price', () => {
    const r = reorderLines(src, catalog, () => undefined);
    expect(r.lines[0]).toMatchObject({ unitPriceExpected: 7.1, priceSource: 'catalog' });
  });

  it('a list price is only used in the unit it is quoted in (no ₪6/ק״ג on a ₪60 ארגז line)', () => {
    const box = [{ productId: 'p-tomato', rawDescription: 'עגבניות', qtyOrdered: '2', unit: 'ארגז', unitPriceExpected: '60' }];
    const kg = [{ productId: 'p-tomato', listPrice: '6.00', unit: 'ק״ג' }];
    expect(reorderLines(box, kg, () => undefined).lines[0]).toMatchObject({ unit: 'ארגז', unitPriceExpected: 60, priceSource: 'last' });
    // Same unit (whitespace aside): today's list price wins.
    const boxed = [{ productId: 'p-tomato', listPrice: '58', unit: ' ארגז ' }];
    expect(reorderLines(box, boxed, () => undefined).lines[0]).toMatchObject({ unitPriceExpected: 58, priceSource: 'catalog' });
    // Listed in another unit only and never priced before: no price rather than a wrong one.
    const unpriced = [{ ...box[0]!, unitPriceExpected: null }];
    expect(reorderLines(unpriced, kg, () => undefined).lines[0]).toMatchObject({ unitPriceExpected: undefined, priceSource: 'none' });
    // Still available: the product is listed, just in another unit.
    expect(reorderLines(box, kg, () => undefined).unavailable).toEqual([]);
  });

  it('a capped catalog page never marks a product unavailable', () => {
    const r = reorderLines(src, catalog, () => undefined, false);
    expect(r.unavailable).toEqual([]);
    expect(r.lines.map((l) => l.rawDescription)).toContain('חסה אייסברג');
  });

  it('with no catalog at all every product line is kept at its last price', () => {
    const r = reorderLines(src, [], () => undefined);
    expect(r.unavailable).toEqual([]);
    expect(r.lines).toHaveLength(4);
    expect(r.lines[2]).toMatchObject({ productId: 'p-gone', unitPriceExpected: 5, priceSource: 'last' });
  });
});

describe('nextDeliveryOptions', () => {
  // 2026-10-25 is a Sunday. 06:00Z = 08:00 IL (IST, UTC+2 after the DST change that night).
  const sunMorning = new Date('2026-10-25T06:00:00Z');
  const sunEvening = new Date('2026-10-25T16:00:00Z'); // 18:00 IL

  it('helpers: local day, weekday, calendar add', () => {
    expect(localNow(sunMorning, TZ)).toEqual({ date: '2026-10-25', hm: '08:00' });
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('no schedule: the next three deliverable days from tomorrow, past Fri/Sat', () => {
    const thu = new Date('2026-10-29T08:00:00Z');
    expect(nextDeliveryOptions(null, thu, TZ).map((o) => o.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(nextDeliveryOptions([], sunMorning, TZ)[0]).toEqual({ date: '2026-10-26', orderBy: null });
  });

  const daily = [
    { orderDays: [0, 1, 2, 3, 4], cutoff: '16:00', fulfillment: { kind: 'lead_days' as const, leadDays: 1 } },
  ];

  it('before the cutoff: order today by 16:00 → tomorrow', () => {
    const o = nextDeliveryOptions(daily, sunMorning, TZ);
    expect(o.map((x) => x.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(o[0]!.orderBy).toEqual({ date: '2026-10-25', cutoff: '16:00' });
  });

  it('after the cutoff today is skipped; Thursday lead-1 rolls past the weekend', () => {
    const o = nextDeliveryOptions(daily, sunEvening, TZ);
    expect(o[0]).toEqual({ date: '2026-10-27', orderBy: { date: '2026-10-26', cutoff: '16:00' } });
    const thuEvening = nextDeliveryOptions(daily, new Date('2026-10-29T15:00:00Z'), TZ);
    expect(thuEvening[0]!.date).toBe('2026-11-02'); // Sun's order → Mon
  });

  it('next_named_day: Sunday orders deliver on Tuesday', () => {
    const tue = [{ orderDays: [0], cutoff: '12:00', fulfillment: { kind: 'next_named_day' as const, deliversOnDay: 2 } }];
    const o = nextDeliveryOptions(tue, sunMorning, TZ, 2);
    expect(o).toEqual([
      { date: '2026-10-27', orderBy: { date: '2026-10-25', cutoff: '12:00' } },
      { date: '2026-11-03', orderBy: { date: '2026-11-01', cutoff: '12:00' } },
    ]);
  });
});

describe('draft store', () => {
  const line = (key: string, extra: Partial<CartLine> = {}): CartLine => ({
    key,
    productId: `p-${key}`,
    rawDescription: `item ${key}`,
    qty: 2,
    unit: 'ק״ג',
    unitPriceExpected: 10,
    ...extra,
  });
  const cart = (lines: CartLine[], extra: Partial<Cart> = {}): Cart => ({ ...emptyCart(), lines, ...extra });

  it('round-trips and drops malformed, empty or stale carts', () => {
    const now = Date.now();
    const raw = JSON.stringify({
      activeSupplierId: 's1',
      carts: {
        s1: cart([line('a'), { bad: true } as unknown as CartLine], { updatedAt: now }),
        s2: cart([], { updatedAt: now }),
        s3: cart([line('b')], { updatedAt: now - 30 * 24 * 3600 * 1000 }),
      },
    });
    const store = parseStore(raw, now);
    expect(store.activeSupplierId).toBe('s1');
    expect(Object.keys(store.carts)).toEqual(['s1']);
    expect(store.carts.s1!.lines).toHaveLength(1);
    expect(parseStore('{not json')).toEqual({ activeSupplierId: null, carts: {} });
    expect(parseStore(null)).toEqual({ activeSupplierId: null, carts: {} });
  });

  it('switching supplier keeps both carts; an emptied cart is dropped', () => {
    let s = withCart({ activeSupplierId: null, carts: {} }, 's1', cart([line('a')]));
    s = withCart(s, 's2', cart([line('b')]));
    expect(Object.keys(s.carts).sort()).toEqual(['s1', 's2']);
    s = withCart(s, 's1', cart([]));
    expect(Object.keys(s.carts)).toEqual(['s2']);
  });

  const srv = (id: string, l: CartLine): ServerLine => ({
    id,
    productId: l.productId ?? null,
    rawDescription: l.rawDescription,
    qty: l.qty,
    unit: l.unit,
    unitPriceExpected: l.unitPriceExpected ?? null,
  });

  it('pairs read-back rows with their cart lines', () => {
    const lines = [line('a'), line('b'), line('c', { productId: undefined, rawDescription: 'נענע' })];
    const rows = [srv('3', lines[2]!), srv('1', lines[0]!), srv('2', lines[1]!)];
    expect(pairServerLines(lines, rows)).toEqual({ a: rows[1], b: rows[2], c: rows[0] });
  });

  it('plans updates and deletes, and a replace when a line was added or the day changed', () => {
    const a = line('a');
    const b = line('b');
    const saved = { deliveryDate: '2026-10-27', lines: { a: srv('1', a), b: srv('2', b) } };
    expect(planDraftSync({ lines: [a, b], deliveryDate: '2026-10-27', server: saved })).toEqual({
      updates: [],
      deletes: [],
      replace: false,
    });
    const edited = planDraftSync({ lines: [{ ...a, qty: 3, unitPriceExpected: undefined }], deliveryDate: '2026-10-27', server: saved });
    expect(edited).toEqual({
      updates: [{ key: 'a', lineId: '1', patch: { qtyOrdered: 3, unitPriceExpected: null } }],
      deletes: ['2'],
      replace: false,
    });
    expect(planDraftSync({ lines: [a, b, line('c')], deliveryDate: '2026-10-27', server: saved }).replace).toBe(true);
    expect(planDraftSync({ lines: [a, b], deliveryDate: '2026-10-28', server: saved }).replace).toBe(true);
    expect(planDraftSync({ lines: [a], deliveryDate: '', server: null }).replace).toBe(true);
  });

  it('compares the EFFECTIVE delivery day: a draft saved for another day is replaced even when nothing was picked', () => {
    const a = line('a');
    const saved = { deliveryDate: '2026-10-27', lines: { a: srv('1', a) } };
    // The manager picked nothing ('' = default) but the default is now the 28th.
    expect(planDraftSync({ lines: [a], deliveryDate: '', deliveryDay: '2026-10-28', server: saved }).replace).toBe(true);
    expect(planDraftSync({ lines: [a], deliveryDate: '', deliveryDay: '2026-10-27', server: saved }).replace).toBe(false);
    // A draft whose day we don't know (resumed before it was read back) can't be trusted.
    const unknownDay = { deliveryDate: '', lines: { a: srv('1', a) } };
    expect(planDraftSync({ lines: [a], deliveryDate: '', deliveryDay: '2026-10-27', server: unknownDay }).replace).toBe(true);
  });
});

describe('order copy is bidi-safe', () => {
  const flat = (o: unknown, out: string[] = []): string[] => {
    if (typeof o === 'string') out.push(o);
    else if (o && typeof o === 'object') for (const v of Object.values(o)) flat(v, out);
    return out;
  };
  it('no message glues "#" to the ref outside the isolate (RTL showed "F8E05686#")', () => {
    for (const m of [...flat(ordersHe), ...flat(ordersEn)]) expect(m).not.toMatch(/#\{ref\}/);
  });
  it('Hebrew arrows point the reading way (← in RTL)', () => {
    for (const m of flat(ordersHe)) expect(m).not.toContain('→');
  });
});

describe('parsePriceInput (strict ₪ entry)', () => {
  it('a 3-digit comma group is thousands; a leading 0 or 1–2 digits make it a decimal comma', () => {
    expect(parsePriceInput('1,250')).toBe(1250);
    expect(parsePriceInput('0,250')).toBe(0.25);
    expect(parsePriceInput('7,5')).toBe(7.5);
    expect(parsePriceInput('12,40')).toBe(12.4);
    expect(parsePriceInput('1,250.50')).toBe(1250.5);
    expect(parsePriceInput('1.250,50')).toBe(1250.5);
    expect(parsePriceInput('12,345,678')).toBe(12345678);
    expect(parsePriceInput(' ₪ 1 250 ')).toBe(1250);
    expect(parsePriceInput('6.90')).toBe(6.9);
  });
  it('blank clears; anything ambiguous or malformed is invalid, never a guess', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('   ')).toBeNull();
    for (const bad of ['1,2,3', '1.2.3', '1,25.5,0', 'abc', '-5', '1e3', '12,3456', '.', ',']) {
      expect(parsePriceInput(bad), bad).toBe('invalid');
    }
  });
});
