/**
 * OCR model benchmark — the production extraction (ClaudeVision, same prompt)
 * plus the production review decision (runOcrPipeline + the arithmetic gate),
 * per model × effort, on:
 *   - the synthetic invoice in packages/ocr/bench (always), and
 *   - every document in BENCH_DIR (optional): a LOCAL folder OUTSIDE git with
 *     real supplier documents (jpg/png/webp/pdf) and, next to each one,
 *     `<name>.truth.json` (template: packages/ocr/bench/truth.template.json).
 *     Real documents are supplier data — never commit them; the runner refuses
 *     a BENCH_DIR inside the repository.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @restomatch/ocr bench
 *   BENCH_DIR=~/restomatch-bench/tsikti BENCH_RUNS=3 ANTHROPIC_API_KEY=… pnpm --filter @restomatch/ocr bench
 *
 * PAID: every run is a real API call. It never runs in CI and refuses to start
 * without ANTHROPIC_API_KEY. Prints a markdown table per model × effort:
 * median / p95 / max seconds, accuracy, money-exact runs, review rate, errors,
 * $ per document (and per photo / per PDF when both kinds are present).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOcrExtractionError, type OcrUsage } from '../errors';
import { runOcrPipeline } from '../pipeline';
import { ClaudeVision, type OcrEffort } from '../providers/claudeVision';
import { StubOcrProvider } from '../providers/stub';
import { scoreExtraction, type TruthInvoice } from './score';

/** $ per 1M tokens (input, output) — Anthropic list prices, 2026-10. */
export const PRICES: Record<string, [number, number]> = {
  'claude-opus-4-8': [5, 25],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export const DEFAULT_MATRIX = 'claude-opus-5-5:low,claude-opus-5-5:medium,claude-sonnet-5-5:low';

const DOC_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.heic', '.heif']);

export function parseMatrix(spec: string): Array<{ model: string; effort?: OcrEffort }> {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [model, effort] = s.split(':');
      return { model: model!, ...(effort ? { effort: effort as OcrEffort } : {}) };
    });
}

/** Nearest-rank percentile (p in 0..100); NaN for an empty list. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export function costUsd(model: string, usage: OcrUsage): number {
  const [pin, pout] = PRICES[model] ?? [NaN, NaN];
  return (usage.inputTokens * pin + usage.outputTokens * pout) / 1e6;
}

/** True when `dir` resolves inside `repoRoot` (a real-documents folder must not). */
export function isInside(dir: string, repoRoot: string): boolean {
  const d = existsSync(dir) ? realpathSync(dir) : resolve(dir);
  const r = existsSync(repoRoot) ? realpathSync(repoRoot) : resolve(repoRoot);
  return d === r || d.startsWith(r + sep);
}

export interface BenchDoc {
  name: string;
  kind: 'photo' | 'pdf';
  bytes: Buffer;
  truth?: TruthInvoice;
}

const expandHome = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** Documents in a BENCH_DIR (sorted by name); a `<name>.truth.json` next to one is its truth. */
export function loadBenchDir(dir: string): BenchDoc[] {
  return readdirSync(dir)
    .filter((f) => DOC_EXTS.has(extname(f).toLowerCase()) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => {
      const stem = basename(f, extname(f));
      const truthPath = join(dir, `${stem}.truth.json`);
      return {
        name: f,
        kind: extname(f).toLowerCase() === '.pdf' ? 'pdf' : 'photo',
        bytes: readFileSync(join(dir, f)),
        ...(existsSync(truthPath) ? { truth: JSON.parse(readFileSync(truthPath, 'utf8')) as TruthInvoice } : {}),
      } satisfies BenchDoc;
    });
}

interface RunRecord {
  doc: BenchDoc;
  secs?: number;
  costUsd: number;
  review?: boolean;
  reasons: string[];
  accuracy?: number;
  moneyExact?: boolean;
  error?: string;
  misses: string[];
}

const fmt = (n: number, dp = 1) => (Number.isFinite(n) ? n.toFixed(dp) : '—');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function summarize(model: string, effort: OcrEffort | undefined, recs: RunRecord[]): string {
  const secs = recs.map((r) => r.secs).filter((s): s is number => s !== undefined);
  const scored = recs.filter((r) => r.accuracy !== undefined);
  const ok = recs.filter((r) => !r.error);
  const errors = recs.length - ok.length;
  const reviewRate = ok.length ? ok.filter((r) => r.review).length / ok.length : NaN;
  const perKind = (k: BenchDoc['kind']) => mean(recs.filter((r) => r.doc.kind === k).map((r) => r.costUsd));
  const misses = new Map<string, number>();
  for (const r of recs) for (const m of [...r.misses, ...r.reasons, ...(r.error ? [r.error] : [])]) misses.set(m, (misses.get(m) ?? 0) + 1);
  const top = [...misses].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([f, n]) => `${f}×${n}`).join(', ');
  return [
    model,
    effort ?? '(default low)',
    fmt(percentile(secs, 50)),
    fmt(percentile(secs, 95)),
    fmt(Math.max(...secs, NaN)),
    scored.length ? `${fmt(percentile(scored.map((r) => r.accuracy! * 100), 50), 0)}%` : '—',
    scored.length ? `${scored.filter((r) => r.moneyExact).length}/${scored.length}` : '—',
    Number.isFinite(reviewRate) ? `${fmt(reviewRate * 100, 0)}%` : '—',
    String(errors),
    `$${fmt(mean(recs.map((r) => r.costUsd)), 4)}`,
    `$${fmt(perKind('photo'), 4)}`,
    `$${fmt(perKind('pdf'), 4)}`,
    top || '—',
  ].join(' | ');
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('bench: ANTHROPIC_API_KEY is not set — this benchmark makes paid API calls; nothing was run.');
    process.exit(2);
  }
  const docs: BenchDoc[] = [
    {
      name: 'synthetic invoice-1.png',
      kind: 'photo',
      bytes: readFileSync(new URL('../../bench/invoice-1.png', import.meta.url)),
      truth: JSON.parse(readFileSync(new URL('../../bench/invoice-1.truth.json', import.meta.url), 'utf8')) as TruthInvoice,
    },
  ];
  if (process.env.BENCH_DIR) {
    const dir = resolve(expandHome(process.env.BENCH_DIR));
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    if (isInside(dir, repoRoot)) {
      console.error('bench: BENCH_DIR is inside the git repository — real supplier documents must live outside it. Nothing was run.');
      process.exit(2);
    }
    if (!existsSync(dir)) {
      console.error(`bench: BENCH_DIR does not exist (${dir}). Nothing was run.`);
      process.exit(2);
    }
    const local = loadBenchDir(dir);
    console.error(`bench: ${local.length} document(s) from BENCH_DIR (${local.filter((d) => d.truth).length} with truth)`);
    docs.push(...local);
  }
  const runs = Number(process.env.BENCH_RUNS ?? 3);
  const rows: string[] = [];
  for (const { model, effort } of parseMatrix(process.env.BENCH_MATRIX ?? DEFAULT_MATRIX)) {
    const recs: RunRecord[] = [];
    for (const doc of docs) {
      for (let i = 0; i < runs; i++) {
        const provider = new ClaudeVision({ apiKey, model, effort });
        const t0 = performance.now();
        try {
          const got = await provider.extract(doc.bytes);
          const secs = (performance.now() - t0) / 1000;
          const stub = new StubOcrProvider('claude_vision', got);
          const pipe = await runOcrPipeline(doc.bytes, { documentAi: stub, claude: stub });
          const s = doc.truth ? scoreExtraction(doc.truth, got) : undefined;
          recs.push({
            doc,
            secs,
            costUsd: costUsd(model, got.meta.usage),
            review: pipe.needsHumanReview,
            reasons: pipe.checks.reasons,
            accuracy: s?.accuracy,
            moneyExact: s?.moneyExact,
            misses: s?.failures ?? [],
          });
        } catch (err) {
          const code = isOcrExtractionError(err) ? err.code : err instanceof Error ? err.name : 'error';
          const usage = isOcrExtractionError(err) ? err.details.usage : undefined;
          recs.push({ doc, costUsd: usage ? costUsd(model, usage) : 0, reasons: [], misses: [], error: code });
          console.error(`  ${model}:${effort ?? '-'} ${doc.name} run ${i + 1} failed: ${code}`);
        }
      }
    }
    rows.push(`| ${summarize(model, effort, recs)} |`);
    console.error(`done ${model}:${effort ?? '-'}`);
  }
  console.log(`${docs.length} document(s) × ${runs} run(s) per model × effort`);
  console.log('| model | effort | median s | p95 s | max s | accuracy | money-exact | review rate | errors | $/doc | $/photo | $/PDF | top misses / reasons |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
