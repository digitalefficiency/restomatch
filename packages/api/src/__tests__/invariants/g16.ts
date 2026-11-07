/**
 * G-16 API invariants: shared helpers. Warn mode (default) prints the per-area
 * violation counts and passes; G16_MODE=error (W4-01) fails on any violation.
 * Each detector also has a hard self-test with a planted violation, so warn mode
 * never passes because a detector went blind.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@restomatch/db';
import type { Database } from '@restomatch/db';
import { expect } from 'vitest';

export type InvariantMode = 'warn' | 'error';
export const MODE: InvariantMode = process.env.G16_MODE === 'error' ? 'error' : 'warn';

export interface Violation {
  area: string;
  detail: string;
}

/** Prints `[G-16] <rule> · <area>: n` lines; in error mode asserts there are none. */
export function report(rule: string, violations: readonly Violation[]): Record<string, number> {
  const byArea: Record<string, number> = {};
  for (const v of violations) byArea[v.area] = (byArea[v.area] ?? 0) + 1;
  const lines = [`[G-16] invariant ${rule} · mode=${MODE} · total=${violations.length}`];
  for (const [area, n] of Object.entries(byArea).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`[G-16] ${rule} · ${area}: ${n}`);
  }
  for (const v of violations) lines.push(`[G-16]   ${v.area}  ${v.detail}`);
  console.warn(lines.join('\n'));
  if (MODE === 'error') expect(violations.map((v) => `${v.area} ${v.detail}`), `G-16 ${rule}`).toEqual([]);
  return byArea;
}

// ─── statement log ───────────────────────────────────────────────────────────

/**
 * A statement that changes data or takes a row lock. CTE-wrapped DML, MERGE,
 * TRUNCATE, DDL and SELECT … FOR UPDATE / SHARE all count.
 */
export function isWriteStatement(sqlText: string): boolean {
  const s = sqlText.replace(/--[^\n]*\n/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  if (/^(insert|update|delete|merge|truncate|create|alter|drop|copy|grant|revoke|refresh)\b/i.test(s)) return true;
  if (/^with\b/i.test(s) && /\b(insert\s+into|update\s+"?[\w.]+"?\s+(as\s+\w+\s+)?set|delete\s+from)\b/i.test(s)) return true;
  return /\bfor\s+(no\s+key\s+)?(update|share)\b/i.test(s);
}

/**
 * The same connection pool as `db`, with a logger that records every statement
 * Drizzle sends (queries, `execute`, transactions). Statements are appended to `log`.
 */
export function loggedDb(db: Database): { db: Database; log: string[] } {
  const log: string[] = [];
  const client = (db as unknown as { $client: unknown }).$client;
  const logged = drizzle(client as never, {
    schema: schema as unknown as Record<string, unknown>,
    logger: { logQuery: (q: string) => void log.push(q) },
  });
  return { db: logged as unknown as Database, log };
}

// ─── source scans ────────────────────────────────────────────────────────────

export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SKIP = new Set(['node_modules', '.next', 'e2e', '__tests__', '__screenshots__', 'dist', 'test', 'scripts', 'public']);
const SRC = /\.(tsx?|mjs)$/;
const TEST = /\.(test|spec)\.tsx?$/;

export interface SourceText {
  path: string;
  text: string;
}

/** Non-test sources under the given repo-relative roots. */
export function readSources(roots: readonly string[]): SourceText[] {
  const out: SourceText[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!SKIP.has(name)) walk(full);
      } else if (SRC.test(name) && !TEST.test(name) && !name.endsWith('.d.ts')) {
        out.push({ path: relative(REPO_ROOT, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
      }
    }
  };
  for (const r of roots) if (existsSync(join(REPO_ROOT, r))) walk(join(REPO_ROOT, r));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** `api:<router|dir>`, `web:dashboard/<seg>`, `worker:<job>`, `charts`, … */
export function areaOf(path: string): string {
  const parts = path.split('/').filter((s) => !/^\(.*\)$/.test(s));
  const strip = (s: string | undefined) => (s ?? 'root').replace(/\.(tsx?|mjs)$/, '');
  if (parts[0] === 'apps' && parts[1] === 'web') {
    if (parts[2] === 'app') return parts[3] === 'dashboard' ? `web:dashboard/${strip(parts[4])}` : `web:${strip(parts[3])}`;
    return `web:${parts[2]}/${strip(parts[3])}`;
  }
  if (parts[0] === 'apps' && parts[1] === 'worker') return `worker:${strip(parts.at(-1))}`;
  if (parts[0] === 'packages' && parts[1] === 'api') {
    return parts[3] === 'routers' ? `api:${strip(parts[4])}` : `api:${strip(parts[3])}`;
  }
  return parts[1] ?? 'other';
}

export interface Signature {
  id: string;
  pattern: RegExp;
}

/** Every line of `sources` matching a signature, except in the allowed files. */
export function scanSignatures(
  sources: readonly SourceText[],
  signatures: readonly Signature[],
  allowed: (path: string, sig: Signature) => boolean,
): Violation[] {
  const out: Violation[] = [];
  for (const f of sources) {
    const lines = f.text.split('\n');
    lines.forEach((line, i) => {
      // Comments document a rule; they don't define one.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const sig of signatures) {
        if (sig.pattern.test(line) && !allowed(f.path, sig)) {
          out.push({ area: areaOf(f.path), detail: `${sig.id} ${f.path}:${i + 1} ${line.trim().slice(0, 100)}` });
        }
      }
    });
  }
  return out;
}
