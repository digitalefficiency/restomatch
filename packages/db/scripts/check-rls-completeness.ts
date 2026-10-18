/**
 * RLS completeness gate (Epic 0.3) — CI/ops drift check.
 *
 * Fails (exit 1) if any public table carries a `restaurant_id` column but does
 * NOT have row-level security enabled. Run after migrate + provision-rls against
 * the same DB; a new tenant table added without a policy turns from a silent
 * cross-tenant exposure into a red build.
 *
 *   pnpm --filter @restomatch/db check-rls
 *
 * (This is the same invariant the web boot guard asserts via assertRlsEnabled.)
 */
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, { max: 1, prepare: false });
  try {
    const rows = (await client`
      select c.table_name
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public'
        and c.column_name = 'restaurant_id'
        and not pc.relrowsecurity
      order by c.table_name
    `) as unknown as Array<{ table_name: string }>;

    if (rows.length > 0) {
      const tables = rows.map((r) => r.table_name).join(', ');
      console.error(
        `[check-rls] FAIL: tables carry restaurant_id but RLS is DISABLED: ${tables}\n` +
          `Add them to packages/db/drizzle/rls/0002_core_tenant_rls.sql and run provision-rls.`,
      );
      process.exit(1);
    }
    console.log('[check-rls] OK: every restaurant_id table has row-level security enabled.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[check-rls] failed', err);
  process.exit(1);
});
