import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { approvals } from '@/lib/i18n/messages/approvals';
import { formatIls } from '@/lib/money';
import { toleranceLabel } from '../vocab';

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
