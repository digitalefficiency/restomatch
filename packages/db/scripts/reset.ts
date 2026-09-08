import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  if (!url.includes('localhost') && !url.includes('_test')) {
    throw new Error('Refusing to reset non-local non-test database: ' + url);
  }

  const sql = postgres(url, { max: 1, prepare: false });
  // Drop the migration tracker too: with `drizzle.__drizzle_migrations` left in
  // place the migrator believes every migration is applied and skips them, so
  // `pnpm reset` produced an empty public schema and `seed` failed on a missing
  // `plans` table. The `app` schema (RLS helper functions) is recreated by rls/0002.
  console.log('[reset] dropping public, drizzle and app schemas');
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS app CASCADE;
    DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  `);
  console.log('[reset] done');
  await sql.end();
}

main().catch((err) => {
  console.error('[reset] failed', err);
  process.exit(1);
});
