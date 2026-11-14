import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS,
  SAMPLE_GOOD_NEWS_ILS,
  SAMPLE_INVOICES_CHECKED,
  SAMPLE_INVOICES_WITH_GAP,
  SAMPLE_LEAK_ILS,
  SAMPLE_LEAK_PCT,
  SAMPLE_NEEDS,
  SAMPLE_PAID_ILS,
  SAMPLE_PURCHASING_ILS,
} from '../sampleMonth';

/**
 * Conductor M5/Q8 · ONE figure set: the rendered loops (tools/promo SAMPLE) must
 * equal the site's sample month. Parsed as text so apps/web never imports the
 * Remotion package. A mismatch means a loop needs a re-render (and new SHA-256s).
 */
const copy = readFileSync(join(__dirname, '../../../../../../tools/promo/src/copy.ts'), 'utf8');
const block = copy.slice(copy.indexOf('export const SAMPLE = {'), copy.indexOf('};', copy.indexOf('export const SAMPLE = {')));
const num = (re: RegExp): number => {
  const m = block.match(re);
  if (!m) throw new Error(`promo SAMPLE: ${re} not found`);
  return Number(m[1]!.replace(/_/g, ''));
};

describe('W3-06 · tools/promo SAMPLE equals sampleMonth (one figure set)', () => {
  it('headline figures', () => {
    expect(num(/purchasing:\s*([\d_.]+)/)).toBe(SAMPLE_PURCHASING_ILS);
    expect(num(/leakPct:\s*([\d_.]+)/)).toBe(SAMPLE_LEAK_PCT);
    expect(num(/\bleak:\s*([\d_.]+)/)).toBe(SAMPLE_LEAK_ILS);
    expect(num(/unpaid:\s*([\d_.]+)/)).toBe(SAMPLE_CAUGHT_BEFORE_PAYMENT_ILS);
    expect(num(/\bpaid:\s*([\d_.]+)/)).toBe(SAMPLE_PAID_ILS);
    expect(num(/\bchecked:\s*([\d_.]+)/)).toBe(SAMPLE_INVOICES_CHECKED);
    expect(num(/withGap:\s*([\d_.]+)/)).toBe(SAMPLE_INVOICES_WITH_GAP);
    expect(num(/goodNews:\s*([\d_.]+)/)).toBe(SAMPLE_GOOD_NEWS_ILS);
  });

  it('needs rows and the 9:16 example line', () => {
    const decide = SAMPLE_NEEDS.find((n) => n.key === 'decide')!;
    const credit = SAMPLE_NEEDS.find((n) => n.key === 'credit')!;
    expect(num(/decide:\s*\{\s*amount:\s*([\d_.]+)/)).toBe(decide.amountIls);
    expect(num(/decide:\s*\{[^}]*count:\s*(\d+)/)).toBe(decide.count);
    expect(num(/credit:\s*\{\s*amount:\s*([\d_.]+)/)).toBe(credit.amountIls);
    expect(num(/credit:\s*\{[^}]*count:\s*(\d+)/)).toBe(credit.count);
    expect(num(/example:\s*\{\s*amount:\s*([\d_.]+)/)).toBe(SAMPLE_NEEDS[0].example!.amountIls);
  });

  it('the needs card reads the example from SAMPLE, not a literal', () => {
    const cards = readFileSync(join(__dirname, '../../../../../../tools/promo/src/components/SampleCards.tsx'), 'utf8');
    expect(cards).toMatch(/ilsText\(SAMPLE\.example\.amount/);
    expect(cards).not.toMatch(/ilsText\(104\.8/);
  });
});
