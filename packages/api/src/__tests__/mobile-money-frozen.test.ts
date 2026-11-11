import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * G-12b — the mobile app is FROZEN (owner decision 12) and computes no ₪ of its
 * own: no local formatIls, no toLocaleString money, no signed ₪ sums, no ₪0 for
 * unknown, no "הפסד", no "בלש הדליפות". The money lives on the web.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIRS = ['apps/mobile/app/owner', 'apps/mobile/app/manager'];

const files = DIRS.flatMap((d) =>
  readdirSync(join(root, d))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ path: `${d}/${f}`, text: readFileSync(join(root, d, f), 'utf8') })),
);

describe('frozen mobile app: no ₪ maths of its own', () => {
  it('scans the owner and manager screens', () => {
    expect(files.map((f) => f.path).sort()).toEqual([
      'apps/mobile/app/manager/index.tsx',
      'apps/mobile/app/owner/index.tsx',
      'apps/mobile/app/owner/leaks.tsx',
      'apps/mobile/app/owner/suppliers.tsx',
    ]);
  });

  it.each([
    ['toLocaleString', /toLocaleString\(/],
    ['a local formatIls', /function\s+formatIls/],
    ['₪ next to an expression', /₪\{|₪\$\{|\{[^}]*\}\s*₪/],
    ['"הפסד"', /הפסד/],
    ['"בלש הדליפות"', /בלש הדליפות/],
    ['owner.kpis money fields', /monthPotentialLossIls|monthSavingsCapturedIls|monthExcessIls/],
  ])('no %s', (_name, re) => {
    for (const f of files) expect(f.text, f.path).not.toMatch(re);
  });

  it('the owner sees the T4 card that opens the web dashboard', () => {
    const home = files.find((f) => f.path.endsWith('owner/index.tsx'))!.text;
    expect(home).toContain('הנתונים המלאים באתר');
    expect(home).toContain('פתחו באפליקציה');
    expect(home).toMatch(/\/dashboard/);
  });
});
