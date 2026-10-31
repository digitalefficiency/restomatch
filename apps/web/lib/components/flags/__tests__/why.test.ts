import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import { discrepancyExplain, toleranceLabel, whyLine, type WhyFacts as ApprovalsFacts } from '@/app/dashboard/approvals/vocab';
import { leakWhyLabels } from '@/app/dashboard/leaks/why-labels';
import { whySegments, whyText, type WhyFacts, type WhyLabels } from '../why';

/** The approvals adapter W2-04 adopts (one line in vocab.ts): its own copy, the shared formatter. */
function approvalsLabels(locale: 'he' | 'en'): WhyLabels {
  const t = createTranslator(locale, approvals);
  return {
    locale: t.locale,
    layout: 'inline',
    templates: {
      price: t('why.price'),
      priceNoQty: t('why.priceNoQty'),
      priceP90: t('why.priceP90'),
      priceP90NoQty: t('why.priceP90NoQty'),
      sourcePo: t('why.sourcePo'),
      sourceP90: t('why.sourceP90'),
      equals: t('why.equals'),
      qtyOver: t('why.qtyOver'),
      qtyShort: t('why.qtyShort'),
      threshold: t('why.threshold'),
    },
    explain: (type) => discrepancyExplain(t, type),
    tolerance: (raw) => toleranceLabel(t, raw),
  };
}

const TYPES = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'MISSING_ON_INVOICE',
  'UNORDERED_ITEM',
  'UNIT_MISMATCH',
  'TOTAL_MISMATCH',
  'VAT_MISMATCH',
  'DUPLICATE_INVOICE',
  'UNORDERED_ARRIVAL',
  'DATE_ANOMALY',
] as const;

const price: WhyFacts = {
  type: 'PRICE_HIGHER',
  deltaAmount: '100.00',
  expectedValue: '139.0000',
  actualValue: '149.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  qtyBilled: '10',
  billedUnit: 'ק״ג',
  poRef: 'PO-123',
  poDate: '2026-10-14T09:00:00Z',
};

const factsFor = (type: string): WhyFacts =>
  type.startsWith('PRICE')
    ? { ...price, type }
    : type.startsWith('QTY')
      ? { type, deltaAmount: '30', expectedValue: '10', actualValue: '8', toleranceUsed: 'qty: ±2% or 0.5 units', billedUnit: 'ק״ג' }
      : { type, deltaAmount: '42.48', expectedValue: null, actualValue: null, toleranceUsed: null };

describe('whySegments (flags/why.ts)', () => {
  it('inline layout = the approvals whyLine, for every type and both locales (parity for W2-04)', () => {
    for (const locale of ['he', 'en'] as const) {
      const t = createTranslator(locale, approvals);
      for (const type of TYPES) {
        const d = factsFor(type);
        expect(whySegments(d, approvalsLabels(locale))).toEqual(whyLine(t, d as ApprovalsFacts));
      }
      // p90 basis and the no-quantity form too
      const p90 = { ...price, toleranceUsed: 'actual exceeds historical p90 of ₪139.00', qtyBilled: null };
      expect(whySegments(p90, approvalsLabels(locale))).toEqual(whyLine(t, p90 as ApprovalsFacts));
    }
  });

  it('ledger layout reads billed · ordered price with PO · difference · threshold (he)', () => {
    const text = whyText(whySegments(price, leakWhyLabels('he')));
    expect(text).toMatch(/^חויב .*149\.00.* × 10 ק״ג · בהזמנה .*139\.00.* \(PO-123, 14\.10\) · פער .*100\.00.* · סף ±2% מהמחיר או .*5/);
  });

  it('ledger: a p90 basis is never called an order price', () => {
    const p90 = { ...price, toleranceUsed: 'actual exceeds historical p90 of ₪139.00' };
    for (const locale of ['he', 'en'] as const) {
      const text = whyText(whySegments(p90, leakWhyLabels(locale)));
      expect(text).not.toMatch(/בהזמנה|ordered at/);
      expect(text).toMatch(/המחיר הרגיל של הספק \(90 יום\)|the supplier's usual price \(90 days\)/);
      expect(text).not.toMatch(/אחוזון|percentile|חציון/); // plain words, no jargon
    }
  });

  it('ledger: every type gives one non-empty line ending in its difference, both locales', () => {
    for (const locale of ['he', 'en'] as const) {
      for (const type of TYPES) {
        const groups = whySegments(factsFor(type), leakWhyLabels(locale));
        expect(groups.length).toBeGreaterThan(0);
        const text = whyText(groups);
        expect(text).not.toMatch(/\{\w+\}/); // no unfilled placeholder
        expect(text).toMatch(locale === 'he' ? /פער/ : /difference/);
      }
    }
  });

  it('a capped invoice adds the cap note; unavailable shows only "פירוט לא זמין"', () => {
    expect(whyText(whySegments({ ...price, capped: true }, leakWhyLabels('he')))).toMatch(/ · מוגבל לסכום החשבונית$/);
    expect(whySegments({ ...price, unavailable: true }, leakWhyLabels('he'))).toEqual([[{ text: 'פירוט לא זמין' }]]);
    expect(whySegments({ ...price, unavailable: true }, leakWhyLabels('en'))).toEqual([[{ text: 'Breakdown unavailable' }]]);
  });

  it('every ₪, quantity and token is an isolated num segment; line ₪ at 2 dp', () => {
    const groups = whySegments(price, leakWhyLabels('he'));
    const nums = groups.flat().filter((s) => s.num).map((s) => s.text);
    expect(nums.some((n) => /149\.00/.test(n))).toBe(true);
    expect(nums.some((n) => /100\.00/.test(n))).toBe(true);
    expect(nums).toContain('PO-123');
  });

  it('English translates the unit (ק״ג → kg)', () => {
    expect(whyText(whySegments(price, leakWhyLabels('en')))).toMatch(/× 10 kg/);
  });
});
