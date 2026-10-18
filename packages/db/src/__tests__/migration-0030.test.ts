import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationsDir } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * Shape test for 0030_fk_indexes: every index the migration declares exists on
 * the migrated DB, and the leak SQL's restaurant-scoped price_history filter has
 * an index that starts with restaurant_id.
 */
const sql = postgres(testDbUrl(), { max: 1, prepare: false });
const file = readFileSync(join(migrationsDir(), '0030_fk_indexes.sql'), 'utf8');
const declared = [...file.matchAll(/CREATE INDEX IF NOT EXISTS "([a-z_]+)" ON "([a-z_]+)"/g)].map((m) => ({
  name: m[1]!,
  table: m[2]!,
}));

afterAll(async () => {
  await sql.end();
});

describe('0030 migration shape', () => {
  it('declares a meaningful set of indexes', () => {
    expect(declared.length).toBeGreaterThanOrEqual(30);
  });

  it('every declared index exists on its table', async () => {
    const rows = (await sql`
      select indexname, tablename from pg_indexes where schemaname = 'public'
    `) as unknown as Array<{ indexname: string; tablename: string }>;
    const have = new Set(rows.map((r) => `${r.tablename}.${r.indexname}`));
    for (const d of declared) expect(have.has(`${d.table}.${d.name}`), d.name).toBe(true);
  });

  it('price_history has a (restaurant_id, observed_at) index for the leaks/KPI SQL', async () => {
    const rows = (await sql`
      select indexdef from pg_indexes where indexname = 'price_history_restaurant_observed_idx'
    `) as unknown as Array<{ indexdef: string }>;
    expect(rows[0]?.indexdef).toMatch(/\(restaurant_id, observed_at\)/);
  });
});
