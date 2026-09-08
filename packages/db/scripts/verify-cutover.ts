/**
 * Post-cutover verification (plan v2, Wave 0). Read-only. Owner-run:
 *
 *   DATABASE_URL=<OWNER_DIRECT> pnpm --filter @restomatch/db verify-cutover \
 *     --web-url=https://project-6bs41.vercel.app --dump=./prod-2026-09-10.dump
 *
 * Flags:
 *   --web-url=<origin>   probe /api/healthz, /privacy, /terms, /cookies, /reset (expect 200)
 *   --dump=<file>        require a pg_dump younger than 2h (backup-before-DDL proof)
 *   --through=<idx>      only require journal entries <= idx (default: latest)
 *   --allow-default-password  skip the "restomatch_app still uses the default password" probe
 *
 * Exit 1 on any FAIL. Skipped checks never fail.
 */
import { formatCheckTable, runCutoverChecks } from '../src/cutoverChecks';

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (owner/direct) is required');
  const local = /localhost|127\.0\.0\.1|_test/.test(url);
  const through = flag('through');
  const results = await runCutoverChecks(url, {
    webUrl: flag('web-url'),
    dumpPath: flag('dump'),
    throughIdx: through ? Number(through) : undefined,
    checkDefaultPassword: !local && !process.argv.includes('--allow-default-password'),
  });
  console.log(formatCheckTable(results));
  const failed = results.filter((r) => !r.ok && !r.skipped);
  if (failed.length > 0) {
    console.error(`\n[verify-cutover] ${failed.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\n[verify-cutover] all checks passed');
}

main().catch((err) => {
  console.error('[verify-cutover] failed', err);
  process.exit(1);
});
