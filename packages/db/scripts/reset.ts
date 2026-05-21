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
  console.log('[reset] dropping public schema');
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  console.log('[reset] done');
  await sql.end();
}

main().catch((err) => {
  console.error('[reset] failed', err);
  process.exit(1);
});
