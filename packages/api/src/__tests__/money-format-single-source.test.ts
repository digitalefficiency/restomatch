import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ilsFromAgorot } from '../orders/document';
import { visualOrder } from '../reports/bidi';
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

/* ---------------------------------------------------------------------- *
 * G-13 · the cross-repo ratchet: hand-rolled ₪ outside the utils may only go
 * DOWN. Baseline per file in money-format-ratchet.baseline.json (next to this
 * file); to 0 by W4-01. Regenerate after a cleanup that LOWERS counts with
 * G13_RATCHET_WRITE=1 (never to raise one: route that ₪ through
 * moneyText / formatIlsAgorot / formatIls / <Money> instead).
 * ---------------------------------------------------------------------- */
const ROOT = join(SRC, '..', '..', '..');
const BASELINE = join(dirname(fileURLToPath(import.meta.url)), 'money-format-ratchet.baseline.json');
/** The utils themselves (and this package's own files) are where ₪ formatting is allowed. */
const UTILS = [
  'apps/web/lib/money.ts',
  'packages/api/src/reports/money.ts',
  /^packages\/types\/src\/money\//,
];
const PATTERNS: Record<string, RegExp> = {
  '₪${': /₪\$\{/g,
  '} ₪': /\} ?₪/g,
  "currency: 'ILS'": /currency: ?'ILS'/g,
  'toLocaleString near ₪': /₪.{0,20}toLocaleString|toLocaleString.{0,20}₪/g,
};
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '__tests__', 'e2e', '.turbo', 'test-results']);

function repoSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) out.push(...repoSources(p));
    } else if (/\.(tsx?|mjs|cjs|js)$/.test(name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

type Counts = Record<string, Record<string, number>>;
function scan(): Counts {
  const counts: Counts = {};
  for (const top of ['apps', 'packages']) {
    for (const f of repoSources(join(ROOT, top))) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (UTILS.some((u) => (typeof u === 'string' ? u === rel : u.test(rel)))) continue;
      const text = readFileSync(f, 'utf8');
      for (const [label, re] of Object.entries(PATTERNS)) {
        const n = (text.match(re) ?? []).length;
        if (n) (counts[label] ??= {})[rel] = n;
      }
    }
  }
  for (const label of Object.keys(PATTERNS)) counts[label] ??= {};
  return counts;
}

describe('the ₪ ratchet (G-13): hand-rolled ₪ outside the utils never goes up', () => {
  it('per-file counts are ≤ the committed baseline', () => {
    const now = scan();
    if (process.env.G13_RATCHET_WRITE === '1' || !existsSync(BASELINE)) {
      const sorted = Object.fromEntries(
        Object.entries(now).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))]),
      );
      writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts;
    const up: string[] = [];
    for (const [label, files] of Object.entries(now)) {
      for (const [file, n] of Object.entries(files)) {
        const was = base[label]?.[file] ?? 0;
        if (n > was) up.push(`${label}  ${file}: ${was} → ${n}`);
      }
    }
    expect(up, `₪ formatted by hand — use moneyText / formatIlsAgorot / formatIls / <Money>:\n${up.join('\n')}`).toEqual([]);
  });

  it('the scan sees the known hand-rolled sites (guards against a scan that silently finds nothing)', () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Counts;
    expect(Object.keys(base['₪${'] ?? {}).length).toBeGreaterThan(0);
    // The utils are excluded: the ratchet never counts itself.
    for (const files of Object.values(base)) {
      for (const f of Object.keys(files)) {
        expect(f.startsWith('packages/types/src/money/')).toBe(false);
        expect(f).not.toBe('apps/web/lib/money.ts');
        expect(f).not.toBe('packages/api/src/reports/money.ts');
      }
    }
    // The worker's private Intl is gone (formatIlsAmount delegates).
    expect(base["currency: 'ILS'"]?.['apps/worker/src/lib/notifyHelpers.ts']).toBeUndefined();
  });
});

describe('report output: ₪ left of the digits in he (visualOrder over formatIlsAgorot)', () => {
  it.each([123_450, 8856, 3_083_700])('%s agorot in a supplier line', (agorot) => {
    const amount = formatIlsAgorot(agorot, { maximumFractionDigits: 2 }).replace(/[^\d.,]/g, '');
    const v = visualOrder(`ספק X · ${formatIlsAgorot(agorot, { maximumFractionDigits: 2 })}`, 'rtl');
    expect(v.indexOf('₪')).toBeGreaterThanOrEqual(0);
    expect(v.indexOf('₪')).toBeLessThan(v.indexOf(amount));
  });

  it.todo('order-document PDF: W2-06 adopts visualOrder (orders/document/bidi.ts visualRtl → @restomatch/types visualOrder)');
});
