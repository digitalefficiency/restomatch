import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_SEED } from '@restomatch/db';
import { computeRoi, divHalfUp, monthlyAgorotFromInput, ROI_MAX_MONTHLY_ILS } from '../roi.logic';
import { SAMPLE_LEAK_ILS, SAMPLE_LEAK_PCT, SAMPLE_PURCHASING_ILS } from '../sampleMonth';

const PRO = PLAN_SEED.pro.priceAgorotMonthly;
const read = (p: string) => readFileSync(join(__dirname, '../../../..', p), 'utf8');

describe('W3-06 review M3/M4 · ROI calculator math (integer agorot)', () => {
  it('the sample month gives the sample leak', () => {
    const r = computeRoi(String(SAMPLE_PURCHASING_ILS), SAMPLE_LEAK_PCT, PRO);
    expect(r).toMatchObject({ kind: 'ok', monthlyLeakIls: SAMPLE_LEAK_ILS, annualLeakIls: SAMPLE_LEAK_ILS * 12 });
  });

  it('rounds half-up in agorot, not through a float (₪30,500 × 0.7% → ₪214)', () => {
    expect(30_500 * (0.7 / 100)).toBeLessThan(213.5); // the old float formula rounded this to ₪213
    expect(computeRoi('30,500', 0.7, PRO)).toMatchObject({ kind: 'ok', monthlyLeakIls: 214, annualLeakIls: 2_562 });
    expect(divHalfUp(5, 2)).toBe(3);
    expect(divHalfUp(4, 3)).toBe(1);
  });

  it.each(['', '0', '-5', '-150000', 'abc', 'NaN', 'Infinity', '1e8', '   '])('"%s" → a neutral prompt, never ₪0', (raw) => {
    expect(computeRoi(raw, SAMPLE_LEAK_PCT, PRO)).toEqual({ kind: 'prompt' });
  });

  it('a non-finite or zero leak rate is a prompt too', () => {
    expect(computeRoi('150000', Number.NaN, PRO)).toEqual({ kind: 'prompt' });
    expect(computeRoi('150000', 0, PRO)).toEqual({ kind: 'prompt' });
  });

  it('parses grouping and ₪ through the one input parser', () => {
    expect(monthlyAgorotFromInput('₪ 120,000')).toBe(12_000_000);
    expect(monthlyAgorotFromInput('120000.5')).toBe(12_000_050);
    expect(monthlyAgorotFromInput('1,2,3')).toBeNull();
  });

  it('clamps at ₪100,000,000 and floors a tiny break-even at "<0.01%"', () => {
    expect(monthlyAgorotFromInput('100000000')).toBe(ROI_MAX_MONTHLY_ILS * 100);
    expect(monthlyAgorotFromInput('999999999999')).toBe(ROI_MAX_MONTHLY_ILS * 100);
    const r = computeRoi('999999999999', 5, PRO);
    expect(r).toMatchObject({ kind: 'ok', breakevenBelowFloor: true, pays: true });
  });

  it('break-even is the Pro price as a share of purchasing, in hundredths of a %', () => {
    const r = computeRoi('150000', SAMPLE_LEAK_PCT, PRO);
    expect(r.kind === 'ok' && r.breakevenHundredths).toBe(divHalfUp(PRO * 10_000, 15_000_000));
    expect(r).toMatchObject({ breakevenBelowFloor: false, pays: SAMPLE_LEAK_ILS * 100 > PRO });
  });
});

describe('W3-06 review M2 · the calculator labels the sample on every page', () => {
  it('the sample line lives in the shared calculator; /pricing has no copy of it', () => {
    expect(read('app/(marketing)/_components/RoiCalculator.tsx')).toMatch(/t\('roi\.sample'/);
    expect(read('app/(marketing)/_components/RoiCalculator.tsx')).toMatch(/isSample &&/);
    expect(read('app/(marketing)/pricing/page.tsx')).not.toMatch(/roiSample|SAMPLE_PURCHASING_ILS/);
  });

  it('roi.lead starts from the sample, not "your estimate"', () => {
    expect(read('lib/i18n/messages/landing/he.ts')).toContain("lead: 'התחלנו מהמסעדה לדוגמה — שנו לרכש ולהערכה שלכם.'");
  });

  it('VAT: purchasing and the plan price are both labelled ex-VAT (M9)', () => {
    const he = read('lib/i18n/messages/marketing/he.ts');
    expect(he).toMatch(/monthly: 'רכש חודשי מספקים \(לפני מע״מ\)'/);
    expect(he).toMatch(/\(\{price\} \+ מע״מ/);
  });
});
