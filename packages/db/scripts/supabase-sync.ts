/**
 * Regenerate `supabase/` (config.toml + migrations) from the drizzle journal.
 *
 *   pnpm db:supabase-sync           # write
 *   pnpm db:supabase-sync --check   # exit 1 if supabase/ is stale (CI / pre-commit)
 *
 * Run it after adding a drizzle migration or changing drizzle/rls/*, and commit
 * the result. See src/supabaseSync.ts and docs/SUPABASE-GITHUB-DEPLOY.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { planSupabaseSync, repoRoot } from '../src/supabaseSync';

const root = repoRoot();
const plan = planSupabaseSync(root);
const check = process.argv.includes('--check');

if (check) {
  const problems = [...plan.writes.keys(), ...plan.orphans.map((o) => `${o} (orphan)`)];
  if (problems.length > 0) {
    console.error(`[supabase-sync] supabase/ is STALE — run \`pnpm db:supabase-sync\` and commit:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[supabase-sync] up to date (${plan.unchanged.length} files)`);
} else {
  for (const [rel, body] of plan.writes) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    console.log(`[supabase-sync] wrote ${rel}`);
  }
  for (const o of plan.orphans) console.warn(`[supabase-sync] WARNING: ${o} is no longer generated — delete it only if it was never deployed`);
  console.log(`[supabase-sync] ${plan.writes.size} written, ${plan.unchanged.length} unchanged`);
}
