/**
 * Repair the rows that make guarded migrations abort (0020 NULL-tenant scans,
 * 0021 cross-tenant products, 0027 duplicate goods receipts) — see src/repairs.ts.
 *
 *   DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db repair-preconditions          # DRY RUN
 *   DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db repair-preconditions --apply  # writes
 *
 * Everything runs in ONE transaction. The dry run performs the repairs and then
 * ROLLS BACK, so the counts it prints are exactly what --apply will change.
 * Take the backup first (docs/DB-RUNBOOK.md §1). Exit 1 if rows remain that a
 * human must attribute (blocking > 0).
 */
import postgres from 'postgres';
import { redactUrl } from '../src/doctor';
import { repairAllPreconditions, type RepairResult } from '../src/repairs';

class DryRun extends Error {}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (owner/direct) is required');
  const apply = process.argv.includes('--apply');
  console.log(`[repair] ${apply ? 'APPLYING to' : 'dry run (rolled back) on'} ${redactUrl(url)}`);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  let results: RepairResult[] = [];
  try {
    await sql.begin(async (tx) => {
      results = await repairAllPreconditions(tx);
      if (!apply) throw new DryRun();
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  } finally {
    await sql.end();
  }
  for (const r of results) {
    console.log(`  ${r.blocking ? 'BLOCK' : r.changed ? 'FIX  ' : 'OK   '}  ${r.name}: ${r.detail}${r.blocking ? ` — ${r.blocking} row(s) need a human (docs/DB-RUNBOOK.md §3)` : ''}`);
  }
  console.log(apply ? '[repair] committed. Next: pnpm db:doctor' : '[repair] nothing written. Re-run with --apply to commit.');
  if (results.some((r) => r.blocking > 0)) process.exit(1);
}

main().catch((err) => {
  console.error('[repair] failed', err instanceof Error ? err.message : err);
  process.exit(2);
});
