/**
 * COVERAGE manifest fragments (W2-01).
 *
 * The cross-tenant suite declares every tRPC procedure in one COVERAGE map. That
 * map is now BASE_COVERAGE (human-owned, in cross-tenant.attack.test.ts) merged
 * with one fragment file per package in this directory (`coverage/<ID>.ts`), so
 * parallel packages never collide on the immutable base file.
 *
 * mergeCoverage() is strict on purpose — a fragment can only ADD procedures:
 *   1. a key declared twice (base↔fragment or fragment↔fragment) throws, naming both
 *      sources — so a fragment can never override, and so never downgrade, a base entry;
 *   2. a fragment file name must be a package id (W2-09.ts, W2-09a.ts, G-07.ts, H-03.ts);
 *   3. a fragment value is `attack — <file>.test.ts: <claim>` /
 *      `isolation — <file>.test.ts: <claim>`, or a justification of ≥30 characters
 *      without "TODO". A bare 'attack' / 'isolation' is base-only ("a test below");
 *   4. every `<file>.test.ts` a fragment value names must exist under src/__tests__/.
 *
 * See ./README.md for the template.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare global {
  interface ImportMeta {
    glob<T>(pattern: string | string[], options: { eager: true }): Record<string, T>;
  }
}

export type CoverageFragment = Readonly<Record<string, string>>;

export interface MergeOptions {
  /** Whether `name` (relative to src/__tests__/) exists. Defaults to the real file system. */
  testFileExists?: (name: string) => boolean;
}

const TESTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SOURCE = 'BASE_COVERAGE (cross-tenant.attack.test.ts)';
const FRAGMENT_FILE = /^(W[1-4]-\d{2}[a-z]?|G-\d{2}|H-\d{2})\.ts$/;
const TESTED_VALUE = /^(attack|isolation)\s+[—-]\s+[\w./-]+\.test\.ts(\s*\+\s*[\w./-]+\.test\.ts)*:\s*\S/s;
const TEST_FILE_REF = /[\w./-]+\.test\.ts/g;
const MIN_JUSTIFICATION = 30;

function defaultTestFileExists(name: string): boolean {
  return existsSync(join(TESTS_DIR, name));
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Every `coverage/<ID>.ts` fragment, keyed by its glob path (`./W2-02.ts`). Never index.ts. */
export function loadFragments(): Record<string, CoverageFragment> {
  const modules = import.meta.glob<{ default: CoverageFragment }>(['./*.ts', '!./index.ts'], {
    eager: true,
  });
  const out: Record<string, CoverageFragment> = {};
  for (const [path, mod] of Object.entries(modules)) out[path] = mod.default;
  return out;
}

function valueProblem(value: unknown, exists: (name: string) => boolean): string | null {
  if (typeof value !== 'string') return 'value is not a string';
  const v = value.trim();
  if (/^(attack|isolation)\b/i.test(v)) {
    if (!TESTED_VALUE.test(v)) {
      return `"${v}" must read "attack — <file>.test.ts: <claim>" or "isolation — <file>.test.ts: <claim>" (a bare 'attack'/'isolation' is base-only)`;
    }
  } else if (v.length < MIN_JUSTIFICATION || /todo/i.test(v)) {
    return `justification "${v}" must be at least ${MIN_JUSTIFICATION} characters and contain no TODO`;
  }
  const absent = [...v.matchAll(TEST_FILE_REF)].map((m) => m[0]).filter((f) => !exists(f));
  if (absent.length > 0) return `names a test file that does not exist under src/__tests__/: ${absent.join(', ')}`;
  return null;
}

/**
 * BASE_COVERAGE + every fragment, or a thrown Error listing every rejection.
 * Never a plain spread: a spread would let a fragment silently override a base entry.
 */
export function mergeCoverage(
  base: CoverageFragment,
  fragments: Readonly<Record<string, CoverageFragment>>,
  options: MergeOptions = {},
): Record<string, string> {
  const exists = options.testFileExists ?? defaultTestFileExists;
  const merged: Record<string, string> = { ...base };
  const sourceOf = new Map<string, string>(Object.keys(base).map((k) => [k, BASE_SOURCE]));
  const errors: string[] = [];

  for (const path of Object.keys(fragments).sort()) {
    const file = baseName(path);
    const source = `coverage/${file}`;
    const fragment = fragments[path];
    if (!FRAGMENT_FILE.test(file)) {
      errors.push(`${source}: file name must be a package id (W2-09.ts, W2-09a.ts, G-07.ts, H-03.ts)`);
      continue;
    }
    if (!fragment || typeof fragment !== 'object') {
      errors.push(`${source}: must \`export default\` a { 'router.procedure': '<value>' } map`);
      continue;
    }
    for (const [key, value] of Object.entries(fragment)) {
      const first = sourceOf.get(key);
      if (first) {
        errors.push(`'${key}' is declared twice: in ${first} and in ${source} (a fragment may never re-declare a key)`);
        continue;
      }
      const problem = valueProblem(value, exists);
      if (problem) {
        errors.push(`'${key}' in ${source}: ${problem}`);
        continue;
      }
      sourceOf.set(key, source);
      merged[key] = value;
    }
  }

  if (errors.length > 0) {
    throw new Error(`COVERAGE fragments rejected (see coverage/README.md):\n  - ${errors.join('\n  - ')}`);
  }
  return merged;
}

/** missing = registered but undeclared; stale = declared but not registered. Both sorted. */
export function diffCoverage(
  registered: readonly string[],
  declared: readonly string[],
): { missing: string[]; stale: string[] } {
  const reg = new Set(registered);
  const dec = new Set(declared);
  return {
    missing: [...reg].filter((p) => !dec.has(p)).sort(),
    stale: [...dec].filter((p) => !reg.has(p)).sort(),
  };
}
