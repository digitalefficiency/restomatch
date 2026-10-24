/**
 * OCR model benchmark — the production extraction (ClaudeVision, same prompt)
 * on the fixed synthetic invoice in packages/ocr/bench, per model × effort.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @restomatch/ocr bench
 *   BENCH_MATRIX="claude-sonnet-5-5:low,claude-haiku-5-5:low" BENCH_RUNS=5 …
 *
 * PAID: every run is a real API call (≈ cents each). It never runs in CI and
 * refuses to start without ANTHROPIC_API_KEY. Prints a markdown table:
 * median / max seconds, field accuracy, money-exact runs, est. $ per invoice.
 */
import { readFileSync } from 'node:fs';
import { ClaudeVision, type OcrEffort } from '../providers/claudeVision';
import { scoreExtraction, type TruthInvoice } from './score';

/** $ per 1M tokens (input, output) — Anthropic list prices, 2026-10. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-4-8': [5, 25],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export const DEFAULT_MATRIX = 'claude-opus-4-8:,claude-opus-5-5:low,claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-haiku-5-5:low';

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

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('bench: ANTHROPIC_API_KEY is not set — this benchmark makes paid API calls; nothing was run.');
    process.exit(2);
  }
  const image = readFileSync(new URL('../../bench/invoice-1.png', import.meta.url));
  const truth = JSON.parse(readFileSync(new URL('../../bench/invoice-1.truth.json', import.meta.url), 'utf8')) as TruthInvoice;
  const runs = Number(process.env.BENCH_RUNS ?? 3);
  const rows: string[] = [];
  for (const { model, effort } of parseMatrix(process.env.BENCH_MATRIX ?? DEFAULT_MATRIX)) {
    const secs: number[] = [];
    const acc: number[] = [];
    let moneyExact = 0;
    let errors = 0;
    let cost = 0;
    const failures = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      let usage: { input_tokens?: number; output_tokens?: number } = {};
      const provider = new ClaudeVision({ apiKey, model, effort, onUsage: (u) => (usage = u) });
      const t0 = performance.now();
      try {
        const got = await provider.extract(image);
        secs.push((performance.now() - t0) / 1000);
        const s = scoreExtraction(truth, got);
        acc.push(s.accuracy);
        if (s.moneyExact) moneyExact++;
        for (const f of s.failures) failures.set(f, (failures.get(f) ?? 0) + 1);
      } catch (err) {
        errors++;
        console.error(`  ${model}:${effort ?? '-'} run ${i + 1} failed: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
      }
      const [pin, pout] = PRICES[model] ?? [NaN, NaN];
      cost += ((usage.input_tokens ?? 0) * pin + (usage.output_tokens ?? 0) * pout) / 1e6;
    }
    const top = [...failures].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${f}×${n}`).join(', ');
    rows.push(
      `| ${model} | ${effort ?? '(default)'} | ${median(secs).toFixed(1)} | ${Math.max(...secs, 0).toFixed(1)} | ${(median(acc) * 100).toFixed(0)}% | ${moneyExact}/${runs} | ${errors} | $${(cost / runs).toFixed(4)} | ${top || '—'} |`,
    );
    console.error(`done ${model}:${effort ?? '-'}`);
  }
  console.log('| model | effort | median s | max s | accuracy | money-exact | errors | $/invoice | top misses |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
