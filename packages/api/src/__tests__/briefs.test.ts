import { describe, expect, it } from 'vitest';
import {
  briefDedupeKey,
  briefPayload,
  eveningBrief,
  findingIdentity,
  goLink,
  identitySetHash,
  isPerishableSkip,
  lateTruckManagerBrief,
  lateTruckReceiverBrief,
  mailtoLink,
  matchAlertBrief,
  newFindingKeys,
  orderReminderBrief,
  receiverMorningBrief,
  waDigits,
  waMeLink,
} from '../briefs';

/** AU-04 · the pure role-brief builders (no DB). Fixed instants, Israel time. */
const RID = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://app.example.test';
const ctx = { restaurantId: RID, baseUrl: BASE };
// 2026-10-25 is a Sunday. IST = UTC+2 after 25.10 (DST ended that night).
const at = (iso: string) => new Date(iso);

const BANNED_HE = /דריש|תביע|מחלוקת|חוב|דליפ|1\.5%/;

describe('links', () => {
  it('go-link carries r and an encoded in-app path', () => {
    expect(goLink(BASE, RID, '/dashboard/receiving')).toBe(
      `${BASE}/dashboard/go?r=${RID}&to=%2Fdashboard%2Freceiving`,
    );
    expect(goLink(`${BASE}/`, RID, 'dashboard/x')).toContain('to=%2Fdashboard%2Fx');
  });

  it.each([
    ['052-123-4567', '972521234567'],
    ['+972 52 123 4567', '972521234567'],
    ['00972521234567', '972521234567'],
    ['972-3-1234567', '97231234567'],
    ['(03) 123-4567', '97231234567'],
    ['+972 052-1234567', '972521234567'],
  ])('waDigits(%s) = %s', (raw, want) => {
    expect(waDigits(raw)).toBe(want);
  });

  it.each(['', '12345', '+1 415 555 0100', 'abc', '052-12', '050-123456', '06-1234567', '07-1234567', '007 1234567', null, undefined])('a bad phone (%s) → null', (raw) => {
    expect(waDigits(raw as string | null | undefined)).toBeNull();
    expect(waMeLink(raw as string | null | undefined, 'x')).toBeNull();
  });

  it('wa.me and mailto encode the Hebrew text', () => {
    expect(waMeLink('0521234567', 'שלום, מתי?')).toBe(
      `https://wa.me/972521234567?text=${encodeURIComponent('שלום, מתי?')}`,
    );
    const m = mailtoLink('orders@tnuva.example', 'נושא', 'גוף & עוד');
    expect(m).toBe(`mailto:orders@tnuva.example?subject=${encodeURIComponent('נושא')}&body=${encodeURIComponent('גוף & עוד')}`);
    expect(mailtoLink('not-an-email', 's', 'b')).toBeNull();
    expect(mailtoLink(null, 's', 'b')).toBeNull();
  });
});

describe('A4 receiver morning brief', () => {
  const deliveries = [
    { supplierName: 'תנובה', expectedAt: at('2026-10-25T06:00:00Z'), lineCount: 12 },
    { supplierName: 'שטראוס', expectedAt: at('2026-10-25T08:30:00Z'), lineCount: 5 },
    { supplierName: 'ירקות השרון', expectedAt: null, lineCount: 1 },
  ];

  it('he: the brief text of the spec', () => {
    const m = receiverMorningBrief({ ...ctx, ilDate: '2026-10-25', deliveries })!;
    expect(m.text.split('\n')[0]).toBe(
      'בוקר טוב · היום צפויים 3 משלוחים: תנובה ~08:00 (12 שורות) · שטראוס ~10:30 (5 שורות) · ירקות השרון (ללא שעה) (שורה אחת)',
    );
    expect(m.subject).toBe('בוקר טוב · היום צפויים 3 משלוחים');
    expect(m.deepLink).toBe(goLink(BASE, RID, '/dashboard/receiving'));
    expect(m.html).toContain('dir="rtl"');
    expect(m.dedupeSuffix).toBe('2026-10-25');
    expect(m.automationId).toBe('A4');
    expect(briefDedupeKey(m, RID, 'u1')).toBe(`au:A4:${RID}:u1:2026-10-25`);
  });

  it('en renders LTR', () => {
    const m = receiverMorningBrief({ ...ctx, locale: 'en', ilDate: '2026-10-25', deliveries })!;
    expect(m.subject).toBe('Good morning · 3 deliveries expected today');
    expect(m.html).toContain('dir="ltr"');
  });

  it('zero deliveries → null (never "0 משלוחים")', () => {
    expect(receiverMorningBrief({ ...ctx, ilDate: '2026-10-25', deliveries: [] })).toBeNull();
  });
});

describe('A7 evening digest', () => {
  const full = {
    ...ctx,
    ilDate: '2026-10-25',
    awaiting: { count: 4, agorot: 124_050, oldestDays: 3 },
    openReceiptsToday: { count: 2 },
    noReplyClaims: { count: 1, agorot: 30_000 },
    intake: { count: 5, oldestHours: 6 },
  };

  it('owner: lines in order, ₪ from agorot, a go-link per line', () => {
    const m = eveningBrief({ ...full, role: 'owner' })!;
    const lines = m.text.split('\n').filter((l) => l.startsWith('• '));
    expect(lines).toEqual([
      expect.stringMatching(/^• מחכות להחלטה שלך: 4 · .*1,241.* · הוותיקה ביותר 3 ימים$/),
      '• קבלות סחורה פתוחות מהיום: 2',
      expect.stringMatching(/^• בקשות זיכוי בלי תשובה 7\+ ימים: 1 · .*300/),
      '• מסמכים ממתינים לבדיקה: 5 · הוותיק 6 שעות',
    ]);
    expect(m.text).toContain(goLink(BASE, RID, '/dashboard/approvals'));
    expect(m.text).toContain(goLink(BASE, RID, '/dashboard/recovery'));
    expect(m.deepLink).toBe(goLink(BASE, RID, '/dashboard/approvals'));
    expect(m.text).not.toMatch(BANNED_HE);
    expect(m.text).not.toContain('זיכויים פתוחים'); // the old never-claimable "open credits" line is gone
  });

  it('an unmerged source (null) omits its line, never shows 0', () => {
    const m = eveningBrief({ ...ctx, role: 'manager', ilDate: '2026-10-25', awaiting: { count: 1, agorot: 5000, oldestDays: 0 } })!;
    expect(m.text).toContain('הוותיקה ביותר מהיום');
    expect(m.text).not.toMatch(/: 0\b/);
    expect(m.text.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(1);
  });

  it('the bookkeeper gets no intake line', () => {
    const m = eveningBrief({ ...full, role: 'bookkeeper' })!;
    expect(m.text).not.toContain('מסמכים ממתינים');
  });

  it('chef and receiver → null; quiet day → null', () => {
    expect(eveningBrief({ ...full, role: 'chef' })).toBeNull();
    expect(eveningBrief({ ...full, role: 'receiver' })).toBeNull();
    expect(
      eveningBrief({ ...ctx, role: 'owner', ilDate: '2026-10-25', awaiting: { count: 0, agorot: 0, oldestDays: 0 }, openReceiptsToday: { count: 0 } }),
    ).toBeNull();
  });

  it('en', () => {
    const m = eveningBrief({ ...full, role: 'owner', locale: 'en' })!;
    expect(m.subject).toBe('End of day · 4 things are waiting for you');
  });
});

describe('A5 order reminder', () => {
  const base = { ...ctx, ilDate: '2026-10-25', supplierId: 's-1', supplierName: 'ירקות השרון', orderDayLabel: 'יום ראשון', cutoffLabel: '16:00' };

  it('a pending draft → "a draft is not an order" + the draft link', () => {
    const m = orderReminderBrief({ ...base, draftPoId: 'po-9' });
    expect(m.subject).toBe('טיוטת הזמנה מ-ירקות השרון עדיין לא נשלחה');
    expect(m.text).toContain('יש טיוטת הזמנה מ-ירקות השרון שעדיין לא נשלחה. טיוטה היא עדיין לא הזמנה. מועד אחרון להזמנה היום: 16:00.');
    expect(m.text).toContain(`פתיחת הטיוטה: ${BASE}/dashboard/orders/po-9`);
    expect(m.deepLink).toBe(`${BASE}/dashboard/orders/po-9`);
    expect(m.dedupeSuffix).toBe('s-1:2026-10-25');
  });

  it('no draft → the wizard with ?supplierId=', () => {
    const m = orderReminderBrief(base);
    expect(m.deepLink).toBe(`${BASE}/dashboard/orders/new?supplierId=s-1`);
    expect(m.subject).toBe('לא בוצעה הזמנה מ-ירקות השרון');
    expect(m.text).toContain('היום יום ראשון הוא יום הזמנה קבוע מ-ירקות השרון');
    expect(m.text).toContain(`יצירת הזמנה: ${BASE}/dashboard/orders/new?supplierId=s-1`);
  });
});

describe('A6 late truck', () => {
  const base = {
    ...ctx,
    poId: 'po-1',
    poRef: '4471',
    supplierName: 'תנובה',
    restaurantName: 'ציקטי',
    expectedAt: at('2026-10-24T06:00:00Z'),
    daysLate: 1,
    lineCount: 3,
    contactWhatsapp: '052-1234567',
    contactEmail: 'orders@tnuva.example',
  };

  it('manager: pre-addressed wa.me + mailto with the partner question', () => {
    const m = lateTruckManagerBrief(base);
    const q = 'שלום תנובה, ההזמנה 4471 שתוכננה ל-24.10 עדיין לא הגיעה. מתי צפוי המשלוח? תודה, ציקטי';
    expect(m.whatsappLink).toBe(`https://wa.me/972521234567?text=${encodeURIComponent(q)}`);
    expect(m.mailtoLink).toContain('mailto:orders@tnuva.example?subject=');
    expect(m.mailtoLink).toContain(encodeURIComponent(q));
    expect(m.text).toContain('שלחו לספק:');
    expect(m.html).toContain('[וואטסאפ]');
    expect(m.html).toContain('[מייל]');
    expect(m.dedupeSuffix).toBe('po-1:d1');
    expect(decodeURIComponent(m.whatsappLink!)).not.toMatch(BANNED_HE);
  });

  it('missing / unreadable contact → the hint, no link', () => {
    const m = lateTruckManagerBrief({ ...base, contactWhatsapp: '123', contactEmail: null });
    expect(m.whatsappLink).toBeNull();
    expect(m.mailtoLink).toBeNull();
    expect(m.text).toContain('אין פרטי קשר לספק · הוסיפו בכרטיס הספק');
    expect(m.html).not.toContain('wa.me');
  });

  it('receiver: day 1 only, no supplier link', () => {
    const r = lateTruckReceiverBrief(base)!;
    expect(r.subject).toBe('איחור באספקה מ-תנובה');
    expect(r.text).toContain('ההזמנה באיחור של יום אחד. מועד צפוי: 24/10.');
    expect(r.text).toContain('ההנהלה מטפלת מול הספק.');
    expect(r.text).not.toContain('שלחו לספק');
    expect(r.text).not.toContain('wa.me');
    expect(r.text).not.toContain('mailto:');
    expect(lateTruckReceiverBrief({ ...base, daysLate: 3 })).toBeNull();
    expect(lateTruckReceiverBrief({ ...base, daysLate: 7 })).toBeNull();
  });
});

describe('A1 match alert on re-match', () => {
  const k = (type: string, line: string) => findingIdentity({ invoiceId: 'inv-1', type, poLineId: line });

  it('identity prefers po_line, then invoice_line, then gr_line', () => {
    expect(findingIdentity({ invoiceId: 'i', type: 'PRICE_HIGHER', poLineId: 'p', invoiceLineId: 'l' })).toBe('i|PRICE_HIGHER|p');
    expect(findingIdentity({ invoiceId: 'i', type: 'PRICE_HIGHER', invoiceLineId: 'l', grLineId: 'g' })).toBe('i|PRICE_HIGHER|l');
    expect(findingIdentity({ invoiceId: 'i', type: 'QTY_SHORT', grLineId: 'g' })).toBe('i|QTY_SHORT|g');
    expect(findingIdentity({ invoiceId: 'i', type: 'DUPLICATE_INVOICE' })).toBe('i|DUPLICATE_INVOICE|-');
  });

  it('only identities absent from the previous run are new (carried-over open AND decided are not)', () => {
    const prev = [k('PRICE_HIGHER', 'a'), k('QTY_SHORT', 'b')];
    expect(newFindingKeys(prev, [k('PRICE_HIGHER', 'a'), k('QTY_SHORT', 'b')])).toEqual([]);
    expect(newFindingKeys(prev, [k('QTY_SHORT', 'b'), k('PRICE_HIGHER', 'c'), k('PRICE_HIGHER', 'c')])).toEqual([k('PRICE_HIGHER', 'c')]);
    expect(newFindingKeys([], [k('B', 'x'), k('A', 'x')])).toEqual([k('A', 'x'), k('B', 'x')]);
  });

  it('hash is order-independent and the dedupe tail never carries a run id', () => {
    expect(identitySetHash(['b', 'a'])).toBe(identitySetHash(['a', 'b']));
    expect(identitySetHash(['a'])).not.toBe(identitySetHash(['a', 'b']));
    const m = matchAlertBrief({ ...ctx, invoiceId: 'inv-1', invoiceRef: '7781', supplierName: 'שטראוס', newKeys: [k('PRICE_HIGHER', 'c')], leakAgorot: 4550 })!;
    expect(m.dedupeSuffix).toBe(`inv-1:${identitySetHash([k('PRICE_HIGHER', 'c')])}`);
    expect(m.text).toContain('נמצא פער חדש בחשבונית 7781 של שטראוס.');
    expect(m.text).toMatch(/אפשר לבקש זיכוי: .*46/);
    expect(m.text).not.toMatch(BANNED_HE);
    expect(m.deepLink).toBe(goLink(BASE, RID, '/dashboard/invoices/inv-1'));
  });

  it('no new finding → null; unknown ₪ → no ₪ line (never ₪0)', () => {
    expect(matchAlertBrief({ ...ctx, invoiceId: 'i', invoiceRef: '1', supplierName: 's', newKeys: [], leakAgorot: 100 })).toBeNull();
    const m = matchAlertBrief({ ...ctx, invoiceId: 'i', invoiceRef: '1', supplierName: 's', newKeys: ['x', 'y'], leakAgorot: null })!;
    expect(m.text).not.toContain('₪');
    expect(m.subject).toBe('2 פערים חדשים בחשבונית של s');
  });
});

describe('perishable morning briefs', () => {
  const slot = at('2026-10-31T04:00:00Z'); // Sat 31.10 06:00 IL
  it('Shabbat 06:00 pushed to 21:00 → skipped', () => {
    expect(isPerishableSkip(slot, at('2026-10-31T19:00:00Z'))).toBe(true);
  });
  it('allowed now, or later but before noon the same IL day → sent', () => {
    expect(isPerishableSkip(slot, slot)).toBe(false);
    expect(isPerishableSkip(slot, at('2026-10-31T09:59:00Z'))).toBe(false); // 11:59 IL
    expect(isPerishableSkip(slot, at('2026-10-31T10:00:00Z'))).toBe(true); // 12:00 IL
  });
  it('the next IL day → skipped', () => {
    expect(isPerishableSkip(at('2026-10-30T21:30:00Z'), at('2026-11-01T04:00:00Z'))).toBe(true);
  });
});

describe('link helpers are linear on hostile input (CodeQL)', () => {
  it('a long run of slashes / dots resolves fast and correctly', () => {
    const slashes = `${BASE}${'/'.repeat(50_000)}`;
    const t0 = Date.now();
    expect(goLink(slashes, RID, '/dashboard')).toBe(`${BASE}/dashboard/go?r=${RID}&to=%2Fdashboard`);
    expect(mailtoLink(`!@!.${'!.'.repeat(50_000)}`, 's', 'b')).toBeNull(); // ends with '.'
    expect(mailtoLink(`!@!.${'!.'.repeat(50_000)}x`, 's', 'b')).not.toBeNull();
    expect(mailtoLink('a@b.', 's', 'b')).toBeNull();
    expect(mailtoLink('a@@b.c', 's', 'b')).toBeNull();
    expect(mailtoLink('@b.c', 's', 'b')).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('payload.invoiceId (AU-07 "acted within 48 h" join)', () => {
  it('A7 always carries the invoice; A6 only when the PO has one; others never', () => {
    const a7 = matchAlertBrief({ ...ctx, invoiceId: 'inv-1', invoiceRef: '1', supplierName: 's', newKeys: ['k'], leakAgorot: null })!;
    expect(briefPayload(a7)).toEqual({ automationId: 'A1', invoiceId: 'inv-1' });
    const late = { ...ctx, poId: 'po-1', poRef: '1', supplierName: 's', restaurantName: 'r', expectedAt: at('2026-10-24T06:00:00Z'), daysLate: 1, lineCount: 1 };
    expect(briefPayload(lateTruckManagerBrief(late))).toEqual({ automationId: 'A6' });
    expect(briefPayload(lateTruckManagerBrief({ ...late, invoiceId: 'inv-9' }))).toEqual({ automationId: 'A6', invoiceId: 'inv-9' });
    expect(briefPayload(lateTruckReceiverBrief({ ...late, invoiceId: 'inv-9' })!)).toEqual({ automationId: 'A6', invoiceId: 'inv-9' });
    const a5 = orderReminderBrief({ ...ctx, ilDate: 'd', supplierId: 's', supplierName: 's', orderDayLabel: 'x' });
    expect(briefPayload(a5)).toEqual({ automationId: 'A5' });
  });
});
