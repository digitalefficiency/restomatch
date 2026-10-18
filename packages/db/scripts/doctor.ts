/**
 * `pnpm db:doctor` — READ-ONLY database health report (see src/doctor.ts).
 * Safe against any DATABASE_URL, production included: every query runs in a
 * `BEGIN READ ONLY` transaction with a statement timeout.
 *
 *   DATABASE_URL=<owner or read-only URL> pnpm db:doctor
 *   DATABASE_URL=… pnpm db:doctor --json        # machine-readable
 *   DATABASE_URL=… pnpm db:doctor --strict      # WARN also exits 1
 *
 * Exit 1 on any FAIL (or WARN with --strict). Prefer the owner/direct URL on
 * Supabase — the pooler works too (prepare:false) but a non-owner role may not
 * see every catalog row.
 */
import { formatDoctorReport, runDoctor } from '../src/doctor';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (any database — the doctor never writes)');
  const report = await runDoctor(url);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report, { color: process.stdout.isTTY }));
  }
  const strict = process.argv.includes('--strict');
  if (!report.ok || (strict && report.counts.WARN > 0)) process.exit(1);
}

main().catch((err) => {
  console.error('[db:doctor] failed', err instanceof Error ? err.message : err);
  process.exit(2);
});
