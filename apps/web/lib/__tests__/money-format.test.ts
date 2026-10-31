import { describe, expect, it } from 'vitest';
import { formatIls } from '../money';

/**
 * H-01 · formatIls() display contract.
 *
 * 1. Byte-identity snapshot: 200 values × {he, en} × {0, 2, 4 dp} = 1,200 strings
 *    of the DEFAULT output. Generated on Node 22 (`.nvmrc`; ICU output is
 *    Node/ICU-version dependent). Never regenerate (`-u`) to make a diff go away:
 *    a diff here means the default ₪ bytes on every screen changed.
 * 2. `signDisplay` (additive option): `exceptZero` for signed deltas, `never` for
 *    an absolute credit shown with a word, `auto` = the default.
 *
 * Invisible bidi marks are escaped as \uXXXX in the snapshot so the diff is readable.
 */

/** Deterministic LCG (Numerical Recipes constants); never Math.random(). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function sampleValues(): number[] {
  const fixed = [
    0, -0,
    0.004, -0.004,
    0.005, -0.005,
    0.01, -0.01,
    1, -1,
    99.995, -99.995,
    1_234.5, -1_234.5,
    1e6, -1e6,
    99_999_999.99, -99_999_999.99,
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ];
  const next = lcg(0x4801);
  const values = [...fixed];
  while (values.length < 200) {
    const magnitude = next() % 9; // 10^0 .. 10^8
    const decimals = next() % 5; // 0..4 fraction digits in the input
    const mantissa = 1 + (next() % 10 ** Math.min(magnitude + decimals + 1, 9)); // never 0
    const sign = next() % 2 === 0 ? 1 : -1;
    const v = (sign * mantissa) / 10 ** decimals;
    if (!values.includes(v)) values.push(v); // 200 distinct values
  }
  return values;
}

const VALUES = sampleValues();
const LOCALES = ['he', 'en'] as const;
const DIGITS = [0, 2, 4] as const;

function visible(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function label(v: number): string {
  return Object.is(v, -0) ? '-0' : String(v);
}

describe('formatIls default output is byte-identical (1,200-string snapshot)', () => {
  it('has 200 deterministic values', () => {
    expect(VALUES).toHaveLength(200);
    expect(new Set(VALUES.map(label)).size).toBe(200);
  });

  for (const locale of LOCALES) {
    for (const maximumFractionDigits of DIGITS) {
      it(`${locale}, ${maximumFractionDigits} dp`, () => {
        const lines = VALUES.map(
          (v) => `${label(v)} → ${visible(formatIls(v, { locale, maximumFractionDigits }))}`,
        );
        expect(lines).toMatchSnapshot();
      });
    }
  }

  it('the Hebrew default is unchanged when locale is omitted', () => {
    for (const v of VALUES) expect(formatIls(v)).toBe(formatIls(v, { locale: 'he' }));
  });
});
