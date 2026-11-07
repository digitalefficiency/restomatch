/**
 * G-16 guard engine: walks the source tree, parses each file with the TypeScript
 * compiler API and runs the rules in ./rules. Pure over (path, text) so the unit
 * test can plant violations in memory; `scanTree` adds the file walk.
 *
 * Mode: every guard starts in WARN (findings are reported with per-area counts and
 * the run exits 0). W4-01 flips them to error (`--strict` / G16_MODE=error); H-09ʰ
 * makes that CI-blocking. Nothing here edits a file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export type GuardMode = 'warn' | 'error';

export function guardMode(env: Record<string, string | undefined> = process.env, argv: readonly string[] = []): GuardMode {
  return argv.includes('--strict') || env.G16_MODE === 'error' ? 'error' : 'warn';
}

export interface Finding {
  rule: string;
  /** Repo-relative path, forward slashes. */
  path: string;
  line: number;
  area: string;
  message: string;
}

/** One parsed source file as the rules see it. */
export interface SourceFile {
  /** Repo-relative path, forward slashes (e.g. `apps/web/app/dashboard/leaks/page.tsx`). */
  path: string;
  text: string;
  ast: ts.SourceFile;
  /** First statement is the `'use client'` directive. */
  isClient: boolean;
  /** Reads a sibling module's text by import specifier (relative only); null when unknown. */
  readImport: (specifier: string) => string | null;
}

export interface Rule {
  id: string;
  /** One line: what the rule fails on. */
  describe: string;
  /** Which files the rule looks at (repo-relative path). */
  applies: (path: string) => boolean;
  check: (file: SourceFile, report: (node: ts.Node, message: string) => void) => void;
}

const norm = (p: string) => p.split(sep).join('/');

/**
 * The area a file belongs to, for the per-area counts:
 * `web:dashboard/<seg>`, `web:<seg>` (other app routes, route groups unwrapped),
 * `web:lib/<seg>`, `api:<router or dir>`.
 */
export function areaOf(path: string): string {
  const p = norm(path);
  const web = p.match(/^apps\/web\/(.*)$/);
  if (web) {
    const parts = web[1]!.split('/').filter((s) => !/^\(.*\)$/.test(s));
    if (parts[0] === 'app') {
      if (parts[1] === 'dashboard') return `web:dashboard/${stripExt(parts[2] ?? 'home')}`;
      return `web:${stripExt(parts[1] ?? 'root')}`;
    }
    if (parts[0] === 'lib') return `web:lib/${stripExt(parts[1] ?? 'root')}`;
    return `web:${stripExt(parts[0] ?? 'root')}`;
  }
  const api = p.match(/^packages\/api\/src\/(.*)$/);
  if (api) {
    const parts = api[1]!.split('/');
    if (parts[0] === 'routers') return `api:${stripExt(parts[1] ?? 'index')}`;
    return `api:${stripExt(parts.length > 1 ? parts[0]! : (parts[0] ?? 'index'))}`;
  }
  const pkg = p.match(/^(?:packages|apps)\/([^/]+)\//);
  return pkg ? `${pkg[1]}` : 'other';
}

function stripExt(s: string) {
  return s.replace(/\.(tsx?|jsx?|mjs)$/, '');
}

function isUseClient(ast: ts.SourceFile): boolean {
  const first = ast.statements[0];
  return (
    first != null &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  );
}

export function parse(path: string, text: string, readImport: SourceFile['readImport'] = () => null): SourceFile {
  const kind = /\.tsx$|\.jsx$/.test(path) ? ts.ScriptKind.TSX : /\.js$|\.mjs$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  return { path: norm(path), text, ast, isClient: isUseClient(ast), readImport };
}

/** Runs `rules` over one file. */
export function checkFile(file: SourceFile, rules: readonly Rule[]): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    if (!rule.applies(file.path)) continue;
    rule.check(file, (node, message) => {
      const { line } = file.ast.getLineAndCharacterOfPosition(node.getStart(file.ast));
      out.push({ rule: rule.id, path: file.path, line: line + 1, area: areaOf(file.path), message });
    });
  }
  return out;
}

/** Convenience for tests: parse + check one in-memory file. */
export function checkSource(path: string, text: string, rules: readonly Rule[], imports: Record<string, string> = {}): Finding[] {
  return checkFile(parse(path, text, (s) => imports[s] ?? null), rules);
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'e2e', '__tests__', '__screenshots__', 'test-results', 'playwright-report', 'scripts', 'test', 'public', 'dist']);
const SOURCE = /\.(tsx?|jsx?|mjs)$/;
const TEST_FILE = /\.(test|spec)\.(tsx?|jsx?)$/;

/** Default scan roots, relative to the repo root. */
export const DEFAULT_ROOTS = ['apps/web/app', 'apps/web/lib', 'packages/api/src'] as const;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (SOURCE.test(name) && !TEST_FILE.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

function importReader(absFile: string) {
  return (specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const base = resolve(dirname(absFile), specifier);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
      if (existsSync(c) && statSync(c).isFile()) return readFileSync(c, 'utf8');
    }
    return null;
  };
}

/** Walks the roots under `repoRoot` and runs every rule. Findings are sorted by path/line. */
export function scanTree(repoRoot: string, rules: readonly Rule[], roots: readonly string[] = DEFAULT_ROOTS): Finding[] {
  const files: string[] = [];
  for (const r of roots) {
    const abs = join(repoRoot, r);
    if (existsSync(abs)) walk(abs, files);
  }
  const out: Finding[] = [];
  for (const abs of files.sort()) {
    const rel = norm(relative(repoRoot, abs));
    out.push(...checkFile(parse(rel, readFileSync(abs, 'utf8'), importReader(abs)), rules));
  }
  return out;
}

export interface Summary {
  total: number;
  /** rule → area → count. */
  byRule: Record<string, Record<string, number>>;
}

export function summarize(findings: readonly Finding[], rules: readonly Rule[]): Summary {
  const byRule: Summary['byRule'] = {};
  for (const r of rules) byRule[r.id] = {};
  for (const f of findings) {
    const areas = (byRule[f.rule] ??= {});
    areas[f.area] = (areas[f.area] ?? 0) + 1;
  }
  return { total: findings.length, byRule };
}

/** `[G-16] <rule> · <area>: n` lines, then a markdown table for the PR body. */
export function formatSummary(summary: Summary, mode: GuardMode): string {
  const lines: string[] = [`[G-16] guards · mode=${mode} · total=${summary.total}`];
  const rows: string[] = ['| Rule | Area | Count |', '|---|---|---|'];
  for (const [rule, areas] of Object.entries(summary.byRule)) {
    const entries = Object.entries(areas).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const n = entries.reduce((s, [, c]) => s + c, 0);
    lines.push(`[G-16] ${rule}: ${n}`);
    for (const [area, c] of entries) {
      lines.push(`[G-16] ${rule} · ${area}: ${c}`);
      rows.push(`| ${rule} | ${area} | ${c} |`);
    }
    if (entries.length === 0) rows.push(`| ${rule} | — | 0 |`);
  }
  return `${lines.join('\n')}\n\n${rows.join('\n')}`;
}
