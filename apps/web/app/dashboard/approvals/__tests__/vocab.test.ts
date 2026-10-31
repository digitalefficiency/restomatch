import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import { formatIls } from '@/lib/money';
import { canEscalate, discrepancyValue, toleranceLabel } from '../vocab';

const he = createTranslator('he', approvals);
const en = createTranslator('en', approvals);
const HEBREW = /[֐-׿]/;

// Every tolerance string packages/matching/src/engine.ts emits (immutable source).
const ENGINE_STRINGS = [
  'price: ±2% or ₪5',
  'qty: ±5% or 1 units',
  'invoice number uniqueness per supplier',
  '±3 days from expected delivery',
  'PO must exist for invoice',
  'unit must match between PO and invoice',
  'billed quantity exceeds received quantity',
  'PO line must appear on invoice',
  'invoice line must match a PO line',
  '±₪1',
  '17% VAT on subtotal, ±₪1',
  'actual exceeds historical p90 of ₪139.35',
];

describe('toleranceLabel', () => {
  it('Hebrew: no engine string leaks through in English', () => {
    for (const raw of ENGINE_STRINGS) {
      const out = toleranceLabel(he, raw);
      expect(out, raw).not.toBe(raw);
      expect(/[a-z]{3,}/i.test(out), `${raw} → ${out}`).toBe(false);
    }
  });

  it('English: readable, never Hebrew', () => {
    for (const raw of ENGINE_STRINGS) expect(HEBREW.test(toleranceLabel(en, raw)), raw).toBe(false);
  });

  it('formats ₪ through formatIls and % per locale', () => {
    expect(toleranceLabel(he, 'price: ±2% or ₪5')).toContain(formatIls(5, { locale: 'he' }));
    expect(toleranceLabel(en, 'price: ±2% or ₪5')).toBe('price ±2% or ₪5');
    expect(toleranceLabel(en, 'actual exceeds historical p90 of ₪139.35')).toContain('₪139.35');
    // Float noise from the engine (0.02 * 100) never shows.
    expect(toleranceLabel(en, 'price: ±2.0000000000000004% or ₪5')).toBe('price ±2% or ₪5');
  });

  it('unknown strings are shown as stored; empty stays empty', () => {
    expect(toleranceLabel(he, 'custom rule 7')).toBe('custom rule 7');
    expect(toleranceLabel(he, null)).toBe('');
  });
});

describe('discrepancyValue', () => {
  it('money types go through formatIls at a fixed 2 decimals (no raw "522.6 ⇆ 575")', () => {
    expect(discrepancyValue('PRICE_HIGHER', '522.6000', 'en')).toBe(formatIls(522.6, { locale: 'en', maximumFractionDigits: 2 }));
    expect(discrepancyValue('PRICE_HIGHER', '575', 'en')).toBe('₪575.00');
    expect(discrepancyValue('PRICE_HIGHER', '522.6', 'en')).toBe('₪522.60');
    expect(discrepancyValue('TOTAL_MISMATCH', '1180', 'he')).toBe(formatIls(1180, { locale: 'he', maximumFractionDigits: 2 }));
  });
  it('quantities are plain locale numbers; non-display types return null', () => {
    expect(discrepancyValue('QTY_SHORT', '8.0000', 'en')).toBe('8');
    expect(discrepancyValue('QTY_OVER', '12.5', 'en')).toBe('12.5');
    expect(discrepancyValue('DATE_ANOMALY', '1792318182540', 'en')).toBeNull();
    expect(discrepancyValue('PRICE_HIGHER', null, 'en')).toBeNull();
  });
});

describe('canEscalate', () => {
  it('never offers "escalate to owner" to the owner, nor on owner-routed items', () => {
    expect(canEscalate('manager', 'owner')).toBe(false);
    expect(canEscalate('owner', 'manager')).toBe(false);
    expect(canEscalate('manager', 'manager')).toBe(true);
    expect(canEscalate('bookkeeper', 'bookkeeper')).toBe(true);
  });
});

describe('headline labels', () => {
  it('the 30-day price-creep figures are never labelled like the monthly leak', async () => {
    const { overview } = await import('@/lib/i18n/messages/overview');
    const { leaks } = await import('@/lib/i18n/messages/leaks');
    for (const locale of ['he', 'en'] as const) {
      const o = createTranslator(locale, overview);
      const l = createTranslator(locale, leaks);
      const hero = o('hero.leakedLabel');
      for (const label of [o('leaks.title'), l('detective.totalLabel')]) {
        expect(label).not.toBe(hero);
        expect(label).toMatch(/30/);
      }
    }
  });
});

/* ───────────────────────── W1-07 · the verb map is locked ───────────────────────── */

import {
  DECISION_RESULT,
  amountLabelKey,
  decisionActions,
  parseDecidedConflict,
  waiveReasons,
  whyLine,
  whyText,
} from '../vocab';
// The server copy (activity titles, approval e-mail). templates.ts has no imports.
import { DECISION_COPY } from '../../../../../../packages/api/src/notifications/templates';

const ALL_TYPES = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
];

describe('decision verbs name what happens to the money (approvals-01, functional-flows-08)', () => {
  it('approve() claims, reject() pays as billed, escalate() goes to the owner', () => {
    expect(DECISION_RESULT).toEqual({ approve: 'accepted', reject: 'rejected', escalate: 'escalated' });
    const [ap, rj] = decisionActions('PRICE_HIGHER');
    expect(ap).toMatchObject({ kind: 'approve', procedure: 'approve' });
    expect(rj).toMatchObject({ kind: 'reject', procedure: 'reject' });
    expect(he(ap!.label as never, { amount: '₪104.80' })).toBe('דרשו ₪104.80 מהספק');
    expect(he(rj!.label as never)).toBe('שלמו כפי שחויב');
    expect(he('decision.escalate')).toBe('העבירו לבעלים');
    expect(en(ap!.label as never, { amount: '₪104.80' })).toBe('Claim ₪104.80 back');
    expect(en(rj!.label as never)).toBe('Pay as billed');
  });

  it('the queue buttons, activity titles and e-mail share ONE copy (packages/api DECISION_COPY)', () => {
    for (const [locale, tr] of [['he', he], ['en', en]] as const) {
      const copy = DECISION_COPY[locale];
      for (const key of ['approve', 'reject', 'escalate', 'approved', 'rejected', 'escalated', 'reopened'] as const) {
        expect(tr(`decision.${key}`), `${locale} ${key}`).toBe(copy[key]);
      }
    }
  });

  it('a "claim" label never sits on reject() and a "pay" label never on approve()', () => {
    for (const type of ALL_TYPES) {
      for (const a of decisionActions(type)) {
        if (a.kind === 'link') continue;
        const text = he(a.label as never, { amount: '₪1' });
        if (a.procedure === 'reject') expect(text, type).not.toMatch(/דרוש/);
        if (a.procedure === 'approve') expect(text, type).not.toMatch(/^שלם/);
      }
    }
  });

  it('UNORDERED_ARRIVAL only links; PRICE_LOWER and MISSING only mark as checked', () => {
    expect(decisionActions('UNORDERED_ARRIVAL')).toEqual([{ kind: 'link', label: 'decision.link' }]);
    expect(he('decision.link')).toBe('שייך להזמנה');
    for (const type of ['PRICE_LOWER', 'MISSING_ON_INVOICE']) {
      const acts = decisionActions(type);
      expect(acts).toHaveLength(1);
      expect(acts[0]).toMatchObject({ kind: 'review', procedure: 'reject' });
      expect(he(acts[0]!.label as never)).toBe('סמנו כנבדק');
    }
  });

  it('every type has 3–5 one-tap waive reasons, "other" last, all translated', () => {
    for (const type of ALL_TYPES) {
      const r = waiveReasons(type);
      expect(r.length, type).toBeGreaterThanOrEqual(3);
      expect(r.length, type).toBeLessThanOrEqual(5);
      expect(r.at(-1)).toBe('other');
      for (const code of r) {
        expect(he(`reasons.${code}` as never)).not.toMatch(/^reasons\./);
        expect(HEBREW.test(en(`reasons.${code}` as never))).toBe(false);
      }
    }
  });

  it('a computed ₪ is never labelled an estimate (approvals-17)', () => {
    expect(he(amountLabelKey('PRICE_HIGHER'))).toBe('חויב ביותר');
    expect(he(amountLabelKey('QTY_OVER'))).toBe('חויב על חוסר');
    expect(he(amountLabelKey('DUPLICATE_INVOICE'))).toBe('סכום בסיכון');
    for (const type of ALL_TYPES) expect(he(amountLabelKey(type))).not.toMatch(/מוערך|הערכה/);
  });
});

describe('whyLine (approvals-06)', () => {
  const fact = {
    type: 'PRICE_HIGHER',
    deltaAmount: '104.80',
    expectedValue: '522.6000',
    actualValue: '575.0000',
    toleranceUsed: 'price: ±2% or ₪5',
    qtyBilled: '2.000',
    billedUnit: 'חבית',
    poRef: 'PO-7781',
    poDate: new Date('2026-10-14T08:00:00Z'),
  };
  const ils = (v: number, locale: 'he' | 'en') => formatIls(v, { locale, maximumFractionDigits: 2 });

  it('price: billed × qty instead of the order price, = the ₪, the %, the threshold', () => {
    expect(whyText(whyLine(en, fact))).toBe(
      '₪575.00 × 2 keg instead of ₪522.60 (order PO-7781, 14/10) = ₪104.80 · +10.0% · threshold price ±2% or ₪5',
    );
    const text = whyText(whyLine(he, fact));
    expect(text).toContain(`${ils(575, 'he')} × 2 חבית במקום ${ils(522.6, 'he')} (הזמנה PO-7781, 14.10) = ${ils(104.8, 'he')}`);
    expect(text).toContain('+10.0%');
    expect(text).toContain('סף');
  });

  it('every number, ₪ and token is an isolated segment (never a bare bidi run)', () => {
    const segs = whyLine(he, fact).flat();
    for (const value of [ils(575, 'he'), '2', 'חבית', ils(522.6, 'he'), 'PO-7781', ils(104.8, 'he')]) {
      expect(segs.find((s) => s.text === value), value).toMatchObject({ num: true });
    }
  });

  it('the usual-price source is named when the engine flagged against p90', () => {
    const text = whyText(whyLine(he, { ...fact, toleranceUsed: 'actual exceeds historical p90 of ₪139.35', poRef: null }));
    expect(text).toContain('(אחוזון 90 של מחירי הספק, לא מחיר הזמנה)');
  });

  it('quantity: billed vs received with its unit', () => {
    expect(
      whyText(
        whyLine(en, {
          type: 'QTY_OVER',
          deltaAmount: '38.70',
          expectedValue: '6.5',
          actualValue: '9.5',
          toleranceUsed: 'billed quantity exceeds received quantity',
          billedUnit: 'kg',
        }),
      ),
    ).toBe('billed 9.5 kg, received 6.5 = ₪38.70 · threshold billed quantity exceeds the received quantity');
  });

  it('other types fall back to the plain explanation', () => {
    expect(whyText(whyLine(he, { type: 'DUPLICATE_INVOICE', deltaAmount: '117', expectedValue: null, actualValue: null, toleranceUsed: null }))).toContain(
      'מספר החשבונית כבר נקלט',
    );
  });
});

describe('parseDecidedConflict', () => {
  it('reads the CONFLICT payload a stale decision gets, ignores anything else', () => {
    expect(
      parseDecidedConflict('approvals.decided:{"status":"accepted","role":"manager","name":null,"at":"2026-10-25T10:00:00.000Z","self":false}'),
    ).toEqual({ status: 'accepted', role: 'manager', name: null, at: '2026-10-25T10:00:00.000Z', self: false });
    expect(parseDecidedConflict('nothing to undo')).toBeNull();
    expect(parseDecidedConflict('approvals.decided:{oops')).toBeNull();
  });
});

describe('verbs keyed by type AND claimability (deep-fix)', () => {
  it('a non-claimable row (info, ₪0) is a check, never "דרוש ₪X"', () => {
    for (const type of ['PRICE_HIGHER', 'QTY_SHORT', 'QTY_OVER', 'UNIT_MISMATCH']) {
      const acts = decisionActions(type, false);
      expect(acts, type).toHaveLength(1);
      expect(acts[0]).toMatchObject({ kind: 'review', procedure: 'reject' });
      expect(he(acts[0]!.label as never)).toBe('סמנו כנבדק');
    }
    expect(decisionActions('PRICE_HIGHER', true)[0]).toMatchObject({ kind: 'approve' });
  });

  it('an accepted duplicate is a hold, never a claim', () => {
    const [ap, rj] = decisionActions('DUPLICATE_INVOICE', true);
    expect(ap).toMatchObject({ kind: 'approve', withAmount: false, done: 'decision.duplicateHeld' });
    expect(he(ap!.label as never)).toBe('אל תשלמו את העותק');
    expect(he(ap!.label as never)).not.toMatch(/דרוש/);
    expect(he((ap as { done: string }).done as never)).toBe(DECISION_COPY.he.duplicateHeld);
    expect(en('decision.duplicateHeld')).toBe(DECISION_COPY.en.duplicateHeld);
    expect(he(rj!.label as never)).toBe('שלמו · זו לא כפולה');
  });

  it('a p90 basis is never shown as an order price', () => {
    const p90 = {
      type: 'PRICE_HIGHER',
      deltaAmount: '19.70',
      expectedValue: '139.35',
      actualValue: '149.20',
      toleranceUsed: 'actual exceeds historical p90 of ₪139.35',
      qtyBilled: '2',
      billedUnit: 'ק״ג',
      poRef: 'PO-7781',
      poDate: new Date('2026-10-14T08:00:00Z'),
    };
    const text = whyText(whyLine(he, p90));
    expect(text).not.toMatch(/הזמנה PO|במקום/);
    expect(text).toContain('מעל');
    expect(text).toContain('אחוזון 90');
    const enText = whyText(whyLine(en, p90));
    expect(enText).not.toMatch(/order PO|instead of/);
    expect(enText).toContain('90th-percentile');
  });
});

describe('pre-merge review findings (#141), web', () => {
  it('F6: the ₪ label states a true fact for every type', () => {
    expect(he(amountLabelKey('MISSING_ON_INVOICE'))).toBe('שווי השורה שלא חויבה');
    expect(he(amountLabelKey('UNORDERED_ITEM'))).toBe('חויב על פריט שלא הוזמן');
    expect(he(amountLabelKey('VAT_MISMATCH'))).toBe('הפרש במע״מ');
    for (const type of ['MISSING_ON_INVOICE', 'UNORDERED_ITEM', 'VAT_MISMATCH']) {
      expect(he(amountLabelKey(type)), type).not.toBe('חויב על חוסר');
      expect(HEBREW.test(en(amountLabelKey(type))), type).toBe(false);
    }
  });

  it('F7: the "mark as checked" done label equals the activity title the server writes', () => {
    expect(he('decision.reviewedDone')).toBe(DECISION_COPY.he.reviewed);
    expect(en('decision.reviewedDone')).toBe(DECISION_COPY.en.reviewed);
  });
});
