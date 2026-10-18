import { findJournalGaps, readJournal, runMigrator } from '../src/migrations';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  // The drizzle migrator only applies entries newer than the newest recorded
  // row, so a gap would be skipped SILENTLY and forever. Refuse instead.
  const gaps = await findJournalGaps(url);
  if (gaps.length > 0) {
    throw new Error(
      `journal gap: ${gaps.map((g) => g.tag).join(', ')} ${gaps.length === 1 ? 'is' : 'are'} older than the newest applied migration but not applied — ` +
        'the migrator would skip them. Apply their SQL by hand in order and record them (docs/DB-RUNBOOK.md §9), or rebuild a local DB with `pnpm --filter @restomatch/db reset`.',
    );
  }

  const latest = readJournal().entries.at(-1)!;
  console.log(`[migrate] applying pending migrations through ${latest.tag} (one transaction)`);
  // Routine "already exists, skipping" notices are swallowed; anything else
  // (e.g. 0032 leaving a CHECK constraint NOT VALID) is surfaced.
  await runMigrator(url, { onNotice: (m) => console.warn(`[migrate] NOTICE: ${m}`) });
  console.log('[migrate] done — run `pnpm db:doctor` to verify');
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
