import { describe, expect, it } from 'vitest';
import { he as leaksHe } from '../i18n/messages/leaks/he';
import { en as leaksEn } from '../i18n/messages/leaks/en';
import { he as receivingHe } from '../i18n/messages/receiving/he';
import { en as receivingEn } from '../i18n/messages/receiving/en';
import { he as approvalsHe } from '../i18n/messages/approvals/he';
import { en as approvalsEn } from '../i18n/messages/approvals/en';
import { he as supplierConfirmHe } from '../i18n/messages/supplierConfirm/he';
import { en as supplierConfirmEn } from '../i18n/messages/supplierConfirm/en';
import { he as suppliersHe } from '../i18n/messages/suppliers/he';
import { en as suppliersEn } from '../i18n/messages/suppliers/en';
import { he as recoveryHe } from '../i18n/messages/recovery/he';
import { en as recoveryEn } from '../i18n/messages/recovery/en';

/**
 * Owner decision 7.11: suppliers are daily partners. Every text a supplier reads uses
 * partner words — "בקשת זיכוי" (our letter is "מכתב בקשת זיכוי"; the supplier's own
 * document is "חשבונית זיכוי"), never a demand, a claim, a dispute, a debt or "late".
 *
 * Supplier-facing = what is printed, sent or shown to the supplier: the credit-request
 * letter and its WhatsApp/e-mail text and reminder, the dock slip shown to the driver,
 * the discrepancy labels that reach that slip, the supplier order-confirm portal and
 * link text, and the printed supplier card (supplierLeakCard is a pilot default).
 */
type Msgs = Record<string, unknown>;
const values = (o: unknown): string[] =>
  typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(values) : [];
const pick = (o: Msgs, keys: readonly string[]) => keys.map((k) => o[k]);

/** The letter body (not the restaurant-facing page around it). */
const LETTER_KEYS = [
  'to',
  'from',
  'businessId',
  'businessIdMissing',
  'letterhead',
  'date',
  'subject',
  'intro',
  'introReplyBy',
  'sectionBeforePayment',
  'sectionForCredit',
  'subtotal',
  'total',
  'closing',
  'signature',
  'math',
  'reason',
  'text',
  'basis',
  'mixedBasis',
] as const;
/** What the printed supplier card renders (the screen-only explorer link is out). */
const CARD_PRINT_KEYS = [
  'title',
  'window',
  'total',
  'lines',
  'topTypes',
  'topLines',
  'open',
  'openLines',
  'scorecard',
  'noScorecard',
  'runs',
  'clean',
  'priceDelta',
  'duplicates',
  'invoice',
  'invoiceNoNumber',
  'cleanTitle',
  'cleanBody',
  'printTitle',
  'printSubtitle',
  'printFooter',
] as const;

function supplierFacing(
  leaks: Msgs,
  receiving: Msgs,
  approvals: Msgs,
  supplierConfirm: Msgs,
  suppliers: Msgs,
  recovery: Msgs,
): Array<{ where: string; text: string }> {
  const claims = leaks.claims as Msgs;
  const groups: Array<[string, unknown]> = [
    ['leaks.claims (letter)', pick(claims, LETTER_KEYS)],
    // One reminder text for the claims page and the recovery tracker (W2-16: one wording per idea).
    ['recovery.reminder.body', (recovery.reminder as Msgs).body],
    ['receiving.dockSlip', receiving.dockSlip],
    ['approvals.types.*.label', Object.values(approvals.types as Record<string, Msgs>).map((t) => t.label)],
    ['supplierConfirm', supplierConfirm],
    ['suppliers.leakCard (print)', pick(suppliers.leakCard as Msgs, CARD_PRINT_KEYS)],
  ];
  return groups.flatMap(([where, v]) => values(v).map((text) => ({ where, text })));
}

const BANNED_HE: RegExp[] = [
  /דריש|דרוש|נדרש/,
  /תביע|לתבוע/,
  /מחלוק/,
  /(^|[^א-ת])חוב(?![א-ת])/,
  /חייב(ים|ת)?\s+(לך|לכם|לנו)/,
  /איחור/,
  /דליפ/,
  /חריג/,
  /עליכם|לאלתר|יש להעביר/,
  /מכתבי? זיכוי/,
];
const BANNED_EN: RegExp[] = [/\bclaim/i, /\bdisput/i, /\bowe[sd]?\b/i, /\boverdue/i, /\bleak/i, /\bdemand/i];

const he = supplierFacing(leaksHe, receivingHe, approvalsHe, supplierConfirmHe, suppliersHe, recoveryHe);
const en = supplierFacing(leaksEn, receivingEn, approvalsEn, supplierConfirmEn, suppliersEn, recoveryEn);

describe('supplier-facing wording: partner words only (owner 7.11)', () => {
  it('covers the supplier-facing strings (sanity)', () => {
    expect(he.length).toBeGreaterThan(80);
    expect(en.length).toBe(he.length);
  });

  it('he: no demand / claim / dispute / debt / late / leak words', () => {
    const hits = he.flatMap(({ where, text }) =>
      BANNED_HE.filter((re) => re.test(text)).map((re) => `${where}: "${text}" ~ ${re}`),
    );
    expect(hits).toEqual([]);
  });

  it('en: no claim / dispute / owe / overdue / leak / demand words', () => {
    const hits = en.flatMap(({ where, text }) =>
      BANNED_EN.filter((re) => re.test(text)).map((re) => `${where}: "${text}" ~ ${re}`),
    );
    expect(hits).toEqual([]);
  });

  it('the letter asks for a credit request and a credit invoice', () => {
    expect(leaksHe.claims.subject).toContain('בקשת זיכוי');
    expect(leaksHe.claims.subject).toContain('פערים');
    expect(leaksHe.claims.introReplyBy).toContain('חשבונית זיכוי');
    expect(leaksEn.claims.subject).toMatch(/credit request/i);
  });
});
