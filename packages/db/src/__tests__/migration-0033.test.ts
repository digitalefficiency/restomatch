import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationsDir } from '../migrations';
import { PLAN_SEED_LIST } from '../plans';
import { plansCatalogSql } from '../plansCatalog';
import { testDbUrl } from '../test-env';

/**
 * Shape test for 0033_plans_catalog (F8): the committed migration is exactly
 * plansCatalogSql() (generated from PLAN_SEED), and a migrated database holds
 * exactly PLAN_SEED — so a fresh Supabase project has a priced catalog.
 */
const sql = postgres(testDbUrl(), { max: 1, prepare: false });

afterAll(async () => {
  await sql.end();
});

describe('0033 migration shape', () => {
  it('the migration file is generated from PLAN_SEED (regenerate if PLAN_SEED changed — as a NEW migration)', () => {
    expect(readFileSync(join(migrationsDir(), '0033_plans_catalog.sql'), 'utf8')).toBe(plansCatalogSql());
  });

  it('applying it yields exactly PLAN_SEED, and re-applying is a no-op', async () => {
    await sql.unsafe(plansCatalogSql());
    await sql.unsafe(plansCatalogSql());
    const rows = (await sql`
      select key, name_he, price_agorot_monthly, limits, features, sort_order from plans
      where key in ${sql(PLAN_SEED_LIST.map((p) => p.key))} order by sort_order
    `) as unknown as Array<Record<string, unknown>>;
    expect(rows).toEqual(
      PLAN_SEED_LIST.map((p) => ({
        key: p.key,
        name_he: p.nameHe,
        price_agorot_monthly: p.priceAgorotMonthly,
        limits: p.limits,
        features: p.features,
        sort_order: p.sortOrder,
      })),
    );
  });
});
