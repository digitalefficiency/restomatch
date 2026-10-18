import { readJournal, runMigrator } from '../src/migrations';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
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
