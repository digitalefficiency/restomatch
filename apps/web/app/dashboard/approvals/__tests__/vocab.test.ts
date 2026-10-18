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
