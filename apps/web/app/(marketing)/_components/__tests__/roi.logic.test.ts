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

  it('rounds half-up in agorot, not through a float (₪30,500 × 0.7% → ₪214); annual = 12 × the shown monthly', () => {
    expect(30_500 * (0.7 / 100)).toBeLessThan(213.5); // the old float formula rounded this to ₪213
    expect(computeRoi('30,500', 0.7, PRO)).toMatchObject({ kind: 'ok', monthlyLeakIls: 214, annualLeakIls: 2_568 });
    expect(divHalfUp(5, 2)).toBe(3);
    expect(divHalfUp(4, 3)).toBe(1);
  });

  it.each(['', '0', '-5', '-150000', 'abc', 'NaN', 'Infinity', '1e8', '   ', '1', '15', '20'])('"%s" → a neutral prompt, never ₪0', (raw) => {
    expect(computeRoi(raw, SAMPLE_LEAK_PCT, PRO)).toEqual({ kind: 'prompt' });
  });

  it('annual always reconciles with the displayed monthly', () => {
    for (const raw of ['30500', '41234', '150000', '987654']) {
      const r = computeRoi(raw, 1.3, PRO);
      if (r.kind !== 'ok') throw new Error(raw);
      expect(r.annualLeakIls).toBe(r.monthlyLeakIls * 12);
    }
  });

  it('"רק X% מהדליפה" only when 0.5 ≤ X < 99.5 — never a "100%" or "0%" ratio', () => {
    const at = (raw: string) => {
      const r = computeRoi(raw, 1.5, PRO);
      if (r.kind !== 'ok') throw new Error(raw);
      return r;
    };
    expect(PRO).toBe(59_000); // the edges below assume the ₪590 Pro price
    // leak ₪591 → X = 99.83 → would read "100%": hidden (pays, so no "over" line either)
    expect(at('39400')).toMatchObject({ pays: true, showCovered: false });
    // leak ₪594 → X = 99.33 → "99%": shown
    expect(at('39600')).toMatchObject({ pays: true, showCovered: true, coveredPct: 99 });
    // leak ₪117,900 → X = 0.50 → shown; leak ₪118,500 → X = 0.498 → would read "0%": hidden
    expect(at('7860000')).toMatchObject({ showCovered: true });
    expect(at('7900000')).toMatchObject({ pays: true, showCovered: false });
    // below the plan price → no ratio, the "over" line instead
    expect(at('30000')).toMatchObject({ pays: false, showCovered: false });
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

describe('W3-06 lab · the purchasing default is shown grouped (150,000), and grouping parses back exactly', () => {
  it('reads he-IL/en grouping back to the same agorot', () => {
    expect(monthlyAgorotFromInput('150,000')).toBe(15_000_000);
    expect(monthlyAgorotFromInput('150000')).toBe(15_000_000);
  });
  it('the calculator seeds and slides through the shared number formatter, never String(n)', () => {
    const src = readFileSync(join(__dirname, '../RoiCalculator.tsx'), 'utf8');
    expect(src).toMatch(/useState\(\(\) => grouped\(SAMPLE_PURCHASING_ILS\)\)/);
    expect(src).not.toMatch(/useState\(String\(SAMPLE_PURCHASING_ILS\)\)/);
    expect(src).toMatch(/setMonthlyRaw\(grouped\(Number\(e\.target\.value\)\)\)/);
  });
});
