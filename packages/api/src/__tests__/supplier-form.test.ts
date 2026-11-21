import { describe, expect, it } from 'vitest';
import { canonicalPaymentTerms, isValidBusinessId, normalizeIsraeliPhone } from '../ledger/supplierFields';

describe('W2-11 · canonical payment terms (the strings computeDueDate parses)', () => {
  it.each([
    ['מזומן', 'מזומן'],
    ['שוטף', 'שוטף'],
    ['שוטף+30', 'שוטף+30'],
    ['שוטף + 30', 'שוטף+30'],
    ['  שוטף +60 ', 'שוטף+60'],
    ['שוטף+0', 'שוטף'],
    ['שוטף + 90', 'שוטף+90'],
    ['30 יום מיום החשבונית', '30 יום מיום החשבונית'],
    ['', null],
    [null, null],
  ])('%s → %s', (raw, out) => {
    expect(canonicalPaymentTerms(raw)).toBe(out);
  });
});

describe('W2-11 · WhatsApp to E.164', () => {
  it.each([
    ['050-123-4567', '+972501234567'],
    ['0501234567', '+972501234567'],
    ['972501234567', '+972501234567'],
    ['+972 50 123 4567', '+972501234567'],
    ['00972501234567', '+972501234567'],
    ['03-1234567', '+97231234567'],
    ['אין', 'אין'],
    ['', null],
  ])('%s → %s', (raw, out) => {
    expect(normalizeIsraeliPhone(raw)).toBe(out);
  });
});

describe('W2-11 · ח״פ check digit', () => {
  it.each([
    ['513906578', true],
    ['51-390657-8', true],
    ['000000018', true],
    ['513906575', false],
    ['12345678', false],
    ['1234567890', false],
    ['', false],
  ])('%s → %s', (raw, ok) => {
    expect(isValidBusinessId(raw)).toBe(ok);
  });
});
