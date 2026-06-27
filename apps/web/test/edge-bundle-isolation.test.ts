import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Edge-bundle isolation guard (B.6).
 *
 * The middleware runs on the EDGE runtime. argon2 (@restomatch/crypto /
 * @node-rs/argon2), otplib and qrcode are node-only native/crypto deps — pulling
 * any of them into the edge bundle breaks the build (or silently bloats it).
 * The Credentials provider + every crypto import live ONLY in auth.ts.
 *
 * This statically crawls the LOCAL import graph reachable from middleware.ts and
 * auth.config.ts (the edge entrypoints) and fails if any reachable local module
 * imports a forbidden node-only dependency.
 */

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const FORBIDDEN = [
  '@restomatch/crypto',
  '@node-rs/argon2',
  'otplib',
  'qrcode',
  'next-auth/providers/credentials',
  './lib/passwords',
  '@/lib/passwords',
];

function resolveLocal(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null; // node_modules — trusted
  const base = spec.startsWith('@/') ? resolve(webRoot, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) {
    if (existsSync(cand) && !cand.endsWith('/')) return cand;
  }
  return null;
}

/** All import specifiers in a source file. */
function importsOf(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specs.push(m[1] ?? m[2]!);
  return specs;
}

/** Crawl the local import graph from an entrypoint; return every reachable specifier. */
function crawl(entry: string): { reachableSpecs: Set<string>; visited: Set<string> } {
  const reachableSpecs = new Set<string>();
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const specs = importsOf(readFileSync(file, 'utf8'));
    for (const spec of specs) {
      reachableSpecs.add(spec);
      const local = resolveLocal(spec, file);
      if (local) stack.push(local);
    }
  }
  return { reachableSpecs, visited };
}

describe('edge bundle excludes argon2 / otplib (B.6)', () => {
  for (const entry of ['middleware.ts', 'auth.config.ts']) {
    it(`${entry} and its local import graph pull in no node-only crypto dep`, () => {
      const { reachableSpecs, visited } = crawl(resolve(webRoot, entry));
      const offenders = [...reachableSpecs].filter((s) =>
        FORBIDDEN.some((f) => s === f || s.endsWith(f) || s.includes(f)),
      );
      expect({ entry, offenders, files: visited.size }).toEqual({
        entry,
        offenders: [],
        files: visited.size,
      });
    });
  }

  it('auth.ts IS the home of the Credentials provider + crypto (sanity)', () => {
    const src = readFileSync(resolve(webRoot, 'auth.ts'), 'utf8');
    expect(src).toContain('next-auth/providers/credentials');
    expect(src).toContain('./lib/passwords');
  });
});
