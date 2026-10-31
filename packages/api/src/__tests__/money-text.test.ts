import { describe, expect, it } from 'vitest';
import {
  FSI,
  MONEY_DECIMALS,
  PDI,
  formatIlsPlain,
  moneyText,
  visualOrder,
  type MoneyContext,
} from '@restomatch/types';
import { formatIlsAgorot } from '../reports/money';
import { visualOrder as reportsVisualOrder } from '../reports/bidi';

/**
 * G-13 · moneyText: the <Money> precision contract + bidi isolation outside
 * JSX (e-mail, WhatsApp, PDF, reports). Inside the isolates it is byte-identical
 * to formatIlsAgorot, which apps/web/lib/__tests__/money-parity.test.ts pins to
 * the web's frozen formatIls().
 */
const CONTEXTS = Object.keys(MONEY_DECIMALS) as MoneyContext[];
const VALUES = [
  0, 1, 5, 49, 50, 99, 100, 101, 1290, 3093, 8856, 12_345, 99_999, 123_450, 123_456, 1_000_000, 3_083_700,
  12_345_678, 99_999_999, -12_345,
];
const inner = (s: string) => {
  expect(s.startsWith(FSI)).toBe(true);
  expect(s.endsWith(PDI)).toBe(true);
  return s.slice(FSI.length, -PDI.length);
};

describe('moneyText', () => {
  it('the precision contract mirrors the web <Money> (hero/tile/inline 0 · line 2 · unit 4)', () => {
    expect(MONEY_DECIMALS).toEqual({ hero: 0, tile: 0, inline: 0, line: 2, unit: 4 });
  });

  it.each(['he', 'en'] as const)('inside FSI…PDI it equals formatIlsAgorot — 20 values × every context (%s)', (locale) => {
    for (const agorot of VALUES) {
      for (const context of CONTEXTS) {
        const text = moneyText({ agorot }, { locale, context });
        expect(inner(text)).toBe(formatIlsAgorot(agorot, { locale, maximumFractionDigits: MONEY_DECIMALS[context] }));
        expect(moneyText({ value: agorot / 100 }, { locale, context })).toBe(text);
      }
    }
  });

  it('locale defaults to he; RLM marks inside the Intl string are kept, never stripped', () => {
    const he = moneyText({ agorot: 123_450 }, { context: 'line' });
    expect(he).toBe(moneyText({ agorot: 123_450 }, { locale: 'he', context: 'line' }));
    const intl = formatIlsAgorot(123_450, { maximumFractionDigits: 2 });
    expect(inner(he)).toBe(intl);
    for (const mark of intl.match(/[‎‏؜]/g) ?? []) expect(he).toContain(mark);
    expect(inner(moneyText({ agorot: 123_450 }, { locale: 'en', context: 'line' }))).toBe('₪1,234.50');
  });

  it('context is required at the type level', () => {
    // @ts-expect-error — no silent precision default: the caller names the context.
    const t = moneyText({ agorot: 100 }, { locale: 'he' });
    expect(typeof t).toBe('string');
  });

  it.skip('signDisplay mirrors H-01 — lands after H-01 merges (formatIls gains signDisplay there; G-13 must not run ahead of the frozen util)', () => {});
});

describe('visualOrder (moved to @restomatch/types; reports/bidi re-exports it)', () => {
  it('reports/bidi re-exports the same function', () => {
    expect(reportsVisualOrder).toBe(visualOrder);
  });

  const amountLeftOfShekel = (line: string, amount: string) => {
    const v = visualOrder(line, 'rtl');
    expect(v).not.toMatch(/[⁦-⁩‎‏]/); // isolates and marks dropped for pdf-lib
    expect(v).toContain(amount);
    expect(v.indexOf('₪')).toBeGreaterThanOrEqual(0);
    expect(v.indexOf('₪')).toBeLessThan(v.indexOf(amount));
  };

  it('he: ₪ sits left of the first digit in a report line with a supplier name', () => {
    amountLeftOfShekel(`ספק תנובה · ${moneyText({ agorot: 123_450 }, { context: 'line' })}`, '1,234.50');
    amountLeftOfShekel(`ספק X · ${formatIlsAgorot(123_450, { maximumFractionDigits: 2 })}`, '1,234.50');
  });

  it('he: … with a percent and a date on the same line', () => {
    amountLeftOfShekel(`מחירים שעלו 4.2% · ${moneyText({ agorot: 98_760 }, { context: 'line' })}`, '987.60');
    amountLeftOfShekel(`חשבונית 31.10.2026 · ${moneyText({ agorot: 5_550_000 }, { context: 'tile' })}`, '55,500');
  });
});

describe('formatIlsAmount (worker EOD e-mail) delegates byte-identically', () => {
  // The worker's helper is now formatIlsPlain(value, {locale:'he', min:d, max:d}); this pins
  // that call to the private Intl it replaced, on end-of-day values.
  const legacy = (value: number, d = 0) =>
    new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(value);
  it.each([0, 1, 12.5, 88.56, 1240, 1240.49, 30_837, 1_234_567.89])('%s', (v) => {
    for (const d of [0, 1, 2, 3]) {
      expect(formatIlsPlain(v, { locale: 'he', minimumFractionDigits: d, maximumFractionDigits: d })).toBe(legacy(v, d));
    }
  });
  it('snapshot of the EOD headline strings', () => {
    expect([0, 1240, 30_837].map((v) => formatIlsPlain(v, { locale: 'he', minimumFractionDigits: 0, maximumFractionDigits: 0 })))
      .toEqual([legacy(0), legacy(1240), legacy(30_837)]);
    expect(formatIlsPlain(1240, { locale: 'he', minimumFractionDigits: 0, maximumFractionDigits: 0 })).toBe('\u200f1,240\u00a0\u200f₪');
  });
});
