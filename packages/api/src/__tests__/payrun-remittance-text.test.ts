import { describe, expect, it } from 'vitest';
import { formatIlsAgorot } from '../reports/money';
import { remittanceText, shareLinks, type RemittanceInput } from '../payRun/remittanceText';

/** AU-14b · the supplier payment note: a draft only (decisions 18 + 19, partner wording). */

const base: RemittanceInput = {
  supplierName: 'שטראוס',
  restaurantName: 'כפר הזיתים',
  paidOn: '2026-12-10',
  paid: [
    { invoiceId: 'i1', invoiceNumber: 'MF-24950', totalAgorot: 736_320 },
    { invoiceId: 'i2', invoiceNumber: 'MF-24951', totalAgorot: 120_000 },
  ],
  offsets: [{ claimId: 'c1', claimNo: '0042', amountAgorot: 10_000, reason: 'חוסר 2 ק״ג סלמון' }],
  inReview: [{ invoiceId: 'i9', invoiceNumber: 'MF-25010' }],
};
const ils = (a: number, l: 'he' | 'en' = 'he') => formatIlsAgorot(a, { locale: l, maximumFractionDigits: 2 });

describe('remittanceText', () => {
  it('he snapshot', () => {
    expect(remittanceText(base).he).toMatchInlineSnapshot(`
      "שלום שטראוס,

      ביום 10.12.2026 שילמנו את החשבוניות האלה:
      • חשבונית MF-24950 · ‏7,363.20 ‏₪
      • חשבונית MF-24951 · ‏1,200.00 ‏₪

      קוזז: ‏100.00 ‏₪ · בקשת זיכוי 0042 · חוסר 2 ק״ג סלמון

      חשבונית MF-25010 בבדיקה · נעדכן

      סה״כ הועבר: ‏8,463.20 ‏₪

      תודה,
      כפר הזיתים"
    `);
  });
  it('en snapshot', () => {
    expect(remittanceText(base).en).toMatchInlineSnapshot(`
      "Hello שטראוס,

      On 10/12/2026 we paid these invoices:
      • Invoice MF-24950 · ₪7,363.20
      • Invoice MF-24951 · ₪1,200.00

      Offset: ₪100.00 · credit request 0042 · חוסר 2 ק״ג סלמון

      Invoice MF-25010 is in review · we will update you

      Total transferred: ₪8,463.20

      Thank you,
      כפר הזיתים"
    `);
  });
  it('net = Σ paid − Σ offsets, integer agorot, via the formatIls twin', () => {
    const r = remittanceText(base);
    expect(r.netAgorot).toBe(736_320 + 120_000 - 10_000);
    expect(r.he).toContain(ils(r.netAgorot));
    expect(r.en).toContain(ils(r.netAgorot, 'en'));
  });
  it('decision 18: an undecided hold says "בבדיקה" with no ₪ and no reason', () => {
    const line = remittanceText(base).he.split('\n').find((l) => l.includes('MF-25010'))!;
    expect(line).toBe('חשבונית MF-25010 בבדיקה · נעדכן');
    expect(line).not.toMatch(/₪|\d+[.,]\d{2}/);
  });
  it('decision 19: an offset credit request is named once; a paid invoice is never also "in review"', () => {
    const r = remittanceText({
      ...base,
      offsets: [...base.offsets, { ...base.offsets[0]! }],
      inReview: [...base.inReview, { invoiceId: 'i1', invoiceNumber: 'MF-24950' }],
    });
    expect(r.he.match(/0042/g)).toHaveLength(1);
    expect(r.netAgorot).toBe(846_320);
    expect(r.he).not.toMatch(/MF-24950 בבדיקה/);
  });
  it('partner wording: בקשת זיכוי, never דרישה / תביעה / מחלוקת / חוב / באיחור', () => {
    const r = remittanceText(base);
    expect(r.he).toContain('בקשת זיכוי');
    expect(r.he).not.toMatch(/דרישה|דרישת|תביעה|מחלוקת|חוב|באיחור/);
    expect(r.en).not.toMatch(/demand|claim|dispute|debt|overdue/i);
  });
  it('no offsets and nothing in review → just paid + net', () => {
    const r = remittanceText({ ...base, offsets: [], inReview: [] });
    expect(r.he).not.toContain('קוזז');
    expect(r.he).not.toContain('בבדיקה');
    expect(r.netAgorot).toBe(856_320);
  });
});

describe('shareLinks (the human taps; nothing is sent)', () => {
  it('wa.me from E.164 only; mailto from a valid address only', () => {
    const l = shareLinks('שלום', { whatsapp: '+972501234567', email: 'a@b.co' }, 'תשלום');
    expect(l.waMe).toBe(`https://wa.me/972501234567?text=${encodeURIComponent('שלום')}`);
    expect(l.mailto).toMatch(/^mailto:a%40b\.co\?subject=/);
    expect(shareLinks('x', { whatsapp: '050-1234567', email: 'nope' }, 's')).toEqual({ waMe: null, mailto: null });
  });
});
