/**
 * G-16 guards CLI. `pnpm --filter @restomatch/web guards [--json] [--list] [--strict]`.
 * Warn mode (default): prints findings + per-area counts and exits 0.
 * `--strict` or G16_MODE=error (W4-01): exits 1 on any finding.
 */
import { fileURLToPath } from 'node:url';
import { formatSummary, guardMode, scanTree, summarize } from './engine';
import { RULES } from './rules';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const argv = process.argv.slice(2);
const mode = guardMode(process.env, argv);
const findings = scanTree(repoRoot, RULES);
const summary = summarize(findings, RULES);

if (argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ mode, summary, findings }, null, 2)}\n`);
} else {
  if (argv.includes('--list')) {
    for (const f of findings) console.log(`${f.path}:${f.line}  ${f.rule}  ${f.message}`);
    console.log('');
  }
  console.log(formatSummary(summary, mode));
}
if (mode === 'error' && findings.length > 0) process.exit(1);
