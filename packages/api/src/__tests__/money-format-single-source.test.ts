import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ilsFromAgorot } from '../orders/document';
import { formatIlsAgorot } from '../reports/money';

/**
 * AGENTS.md: all ₪ rendering goes through ONE formatter — never re-implement
 * `Intl.NumberFormat('he-IL', { style: 'currency' … })` inline. In @restomatch/api
 * that is the server twin formatIlsAgorot (reports/money.ts), which
 * apps/web/lib/__tests__/money-parity.test.ts pins to the web's formatIls().
 * Supplier-facing documents (order email, WhatsApp text, PDF) build on it.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const TWIN = 'reports/money.ts';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('₪ formatting has one source in @restomatch/api', () => {
  it(`no currency Intl.NumberFormat outside ${TWIN}`, () => {
    const offenders = sources(SRC)
      .filter((f) => relative(SRC, f) !== TWIN)
      .filter((f) => /Intl\.NumberFormat\([^)]*currency/s.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the supplier documents print formatIlsAgorot (2 decimals) minus the bidi marks and NBSP', () => {
    for (const agorot of [0, 1, 99, 100, 3093, 8856, 123_456, 3_083_700, 99_999_999]) {
      const twin = formatIlsAgorot(agorot, { maximumFractionDigits: 2 })
        .replace(/[‎‏؜]/g, '')
        .replace(/ /g, ' ')
        .trim();
      expect(ilsFromAgorot(agorot)).toBe(twin);
    }
    expect(ilsFromAgorot(8856)).toBe('88.56 ₪'); // the placed lamb order
    expect(ilsFromAgorot(100)).toBe('1.00 ₪'); // always two decimals on a supplier document
  });
});
