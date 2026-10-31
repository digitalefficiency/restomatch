import { describe, expect, it } from 'vitest';
import { EMAIL_COPY } from '../notifications/copy';
import { FSI, PDI } from '../notifications/copy/fill';
import {
  approvalNeededEmail,
  DECISION_COPY,
  endOfDayReportEmail,
  invoiceOcrFailedEmail,
  inviteEmail,
  magicLinkEmail,
  orderNotPlacedEmail,
  passwordResetEmail,
  supplierDelayEmail,
  taskNoticeEmail,
  weeklyLeakReportEmail,
  type RenderedEmail,
} from '../notifications/templates';

type Tree = { readonly [k: string]: string | Tree };
const leaves = (t: Tree, p = ''): Array<[string, string]> =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v] as [string, string]] : leaves(v, `${p}${k}.`)));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[},]/g)].map((m) => m[1]).sort();
const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');
const EMOJI = /\p{Extended_Pictographic}/u;

/** Every builder, both locales, with representative args (incl. a Latin supplier). */
function everyEmail(): Array<[string, RenderedEmail]> {
  const out: Array<[string, RenderedEmail]> = [];
  for (const locale of ['he', 'en'] as const) {
    out.push(
      [`magic:${locale}`, magicLinkEmail({ url: 'https://app/m', locale })],
      [`reset:${locale}`, passwordResetEmail({ url: 'https://app/r', locale })],
      [`invite:${locale}`, inviteEmail({ url: 'u', restaurantName: 'כפר הזיתים', roleLabel: 'r', inviterName: 'Dana', locale })],
      [`delay:${locale}`, supplierDelayEmail({ supplierName: 'Coca-Cola Ltd.', expectedAtLabel: '20.6', daysLate: 2, lineCount: 1, poUrl: 'u', locale })],
      [`order:${locale}`, orderNotPlacedEmail({ supplierName: 'תנובה', orderDayLabel: 'א׳', cutoffLabel: '12:00', ordersUrl: 'u', locale })],
      [`approval:${locale}`, approvalNeededEmail({ supplierName: 'תנובה', discrepancyCount: 3, atRiskIls: '‏1,240 ₪', approvalsUrl: 'u', locale })],
      [`weekly:${locale}`, weeklyLeakReportEmail({ weekLabel: '13.6–19.6', savedIls: '‏3,500 ₪', leakedIls: '‏820 ₪', topSupplier: 'תנובה', locale })],
      [`eod:${locale}`, endOfDayReportEmail({ dateLabel: '21.6', openCreditsCount: 0, openCreditsIls: '‏0 ₪', todayCaughtCount: 1, todayCaughtIls: '‏120 ₪', locale })],
      [`ocr:${locale}`, invoiceOcrFailedEmail({ supplierName: 'תנובה', fileName: 'scan 12.pdf', reason: 'x', url: 'u', locale })],
      [`task:${locale}`, taskNoticeEmail({ title: 'T', body: 'B', url: 'u', locale })],
    );
  }
  return out;
}

describe('EMAIL_COPY (W2-13)', () => {
  it('he and en have the same keys and the same placeholders', () => {
    const he = new Map(leaves(EMAIL_COPY.he as unknown as Tree));
    const en = new Map(leaves(EMAIL_COPY.en as unknown as Tree));
    expect([...en.keys()].sort()).toEqual([...he.keys()].sort());
    for (const [k, v] of he) expect(placeholders(en.get(k)!), k).toEqual(placeholders(v));
  });

  it('no copy string types a ₪ (₪ only arrives pre-formatted from the money formatter)', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const [k, v] of leaves(EMAIL_COPY[lang] as unknown as Tree)) expect(v, `${lang}:${k}`).not.toMatch(/₪|ש״ח/);
    }
  });

  it('no emoji in any subject, preview or body string', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const [k, v] of leaves(EMAIL_COPY[lang] as unknown as Tree)) expect(EMOJI.test(v), `${lang}:${k}`).toBe(false);
    }
    for (const [name, e] of everyEmail()) expect(EMOJI.test(e.subject), name).toBe(false);
  });

  it('no Hebrew string opens with a masculine-singular imperative (except the pinned DECISION_COPY verbs, W2-04)', () => {
    const masc = /^(בחר|לחץ|הזן|שלח|פתח|שמור|אשר|דחה|העבר|שלם|דרוש|הוסף|צלם|בדוק|נסה|התחבר|עבור)(?![א-ת])/;
    const pinned = new Set(['decision.approve', 'decision.reject', 'decision.escalate']);
    for (const [k, v] of leaves(EMAIL_COPY.he as unknown as Tree)) {
      if (!pinned.has(k)) expect(masc.test(v), k).toBe(false);
    }
    expect(DECISION_COPY.he.approve).toBe('דרוש {amount} מהספק'); // unchanged (W2-04 pins it)
  });

  it.each([
    [1, 'באיחור של יום אחד', '1 day late'],
    [2, 'באיחור של יומיים', '2 days late'],
    [3, 'באיחור של 3 ימים', '3 days late'],
    [11, 'באיחור של 11 ימים', '11 days late'],
  ])('supplier delay: %i day(s) → %s / %s', (days, he, en) => {
    const args = { supplierName: 'תנובה', expectedAtLabel: '1.1', daysLate: days, lineCount: 2 };
    expect(supplierDelayEmail(args).text).toContain(he);
    expect(supplierDelayEmail({ ...args, locale: 'en' }).text).toContain(en);
    expect(supplierDelayEmail(args).text).not.toMatch(/(?<!\d)1 ימים/);
  });

  it('weekly subject: "{week}: נמצאו {found} בפערים · {open} עוד פתוחים", no "נחסכו"', () => {
    const e = weeklyLeakReportEmail({ weekLabel: '13.6–19.6', savedIls: '‏3,500 ₪', leakedIls: '‏820 ₪' });
    expect(strip(e.subject)).toBe('13.6–19.6: נמצאו ‏3,500 ₪ בפערים · ‏820 ₪ עוד פתוחים');
    expect(e.html + e.text).not.toMatch(/נחסכ|דולף|דלפ|הפסד|חיסכון/);
  });

  it('plural address in auth mails (auth-19)', () => {
    expect(magicLinkEmail({ url: 'u' }).text).toContain('פתחו את הקישור');
    expect(magicLinkEmail({ url: 'u' }).text).toContain('אם לא ביקשתם');
    expect(passwordResetEmail({ url: 'u' }).text).toContain('אם לא ביקשתם');
  });

  it('a Latin supplier is isolated (FSI…PDI in text, <bdi> in HTML), never wrapped in ASCII quotes', () => {
    const e = supplierDelayEmail({ supplierName: 'Coca-Cola Ltd.', expectedAtLabel: '1.1', daysLate: 1, lineCount: 1 });
    expect(e.subject).toContain(`${FSI}Coca-Cola Ltd.${PDI}`);
    expect(e.html).toContain(`${FSI}Coca-Cola Ltd.${PDI}`); // heading (renderEmail escapes text)
    const o = orderNotPlacedEmail({ supplierName: 'Coca-Cola Ltd.', orderDayLabel: 'א׳' });
    expect(o.html).toContain('<strong><bdi>Coca-Cola Ltd.</bdi></strong>'); // body markup
    expect(e.html + e.text).not.toMatch(/"Coca|Ltd\."/);
  });

  it('the OCR-failure notice carries no ₪ at all; the task notice shows ₪ only when passed', () => {
    const ocr = invoiceOcrFailedEmail({ supplierName: 'תנובה', fileName: 'a.pdf', url: 'https://app/i/1' });
    expect(ocr.subject).toContain('תנובה');
    expect(ocr.html + ocr.text).not.toMatch(/₪/);
    expect(invoiceOcrFailedEmail({}).subject).toBe('לא הצלחנו לקרוא חשבונית');
    expect(taskNoticeEmail({ title: 'T' }).html).not.toMatch(/₪/);
    expect(taskNoticeEmail({ title: 'T', amountIls: '‏50 ₪' }).html).toContain('‏50 ₪');
  });

  it('OCR failure: uploader vs managers audience, supplier hidden when showSupplier is false', () => {
    const up = invoiceOcrFailedEmail({ audience: 'uploader', fileName: 'scan.pdf' });
    expect(up.text).toContain('צלמו את החשבונית שוב, או שהמנהלים יטפלו בה');
    const mg = invoiceOcrFailedEmail({ audience: 'managers', uploaderName: 'דנה', supplierName: 'תנובה' });
    expect(mg.text).toContain('שהועלתה על ידי דנה');
    expect(mg.subject).toContain('תנובה');
    expect(invoiceOcrFailedEmail({ audience: 'managers' }).text).toContain('מישהו מהצוות');
    const hidden = invoiceOcrFailedEmail({ audience: 'managers', supplierName: 'תנובה', showSupplier: false });
    expect(hidden.subject + hidden.html + hidden.text).not.toContain('תנובה');
    expect(invoiceOcrFailedEmail({ audience: 'managers', uploaderName: 'Dana', locale: 'en' }).text).toContain('uploaded by Dana');
  });

  it('approval e-mail: claimable ₪ and the invoice deep link (W2-04)', () => {
    const e = approvalNeededEmail({
      supplierName: 'תנובה',
      discrepancyCount: 2,
      atRiskIls: '‏900 ₪',
      claimableIls: '‏700 ₪',
      approvalsUrl: 'https://app/dashboard/approvals',
      invoiceUrl: 'https://app/dashboard/go?to=x',
    });
    expect(e.subject).toContain('שני פערים');
    expect(e.html).toContain('‏700 ₪');
    expect(e.html).not.toContain('‏900 ₪');
    expect(e.html).toContain('https://app/dashboard/go?to=x');
    expect(e.html).toContain('דרוש מהספק'); // the queue verb, without the amount placeholder
    expect(e.text).not.toContain('{amount}');
  });

  it('end-of-day subject with no open credits says so in words', () => {
    const args = { dateLabel: '1.1', openCreditsCount: 0, openCreditsIls: '‏0 ₪', todayCaughtCount: 0, todayCaughtIls: '‏0 ₪' };
    expect(endOfDayReportEmail(args).subject).toContain('אין זיכויים פתוחים');
    expect(endOfDayReportEmail(args).subject).not.toMatch(/(?<!\d)0 זיכויים/);
    expect(endOfDayReportEmail({ ...args, locale: 'en' }).subject).toContain('no open credits');
  });

  it('every builder renders every placeholder (no "{name}" left)', () => {
    for (const [name, e] of everyEmail()) {
      expect(`${e.subject}\n${e.html}\n${e.text}`, name).not.toMatch(/\{\w+(?:,\s*plural)?[},]/);
    }
  });

  it('English renders contain no Hebrew besides data', () => {
    for (const [name, e] of everyEmail().filter(([n]) => n.endsWith(':en') && !/invite|order|approval|weekly|ocr/.test(n))) {
      expect(e.html, name).not.toMatch(/[֐-׿]/);
    }
  });
});
