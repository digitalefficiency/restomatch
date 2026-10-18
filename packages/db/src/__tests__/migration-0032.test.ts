import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, suppliers } from '../index';
import { INTEGRITY_CHECKS } from '../integrityChecks';
import { migrationsDir } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * Shape test for 0032_integrity_checks: the SQL file and INTEGRITY_CHECKS (the
 * doctor's copy) never drift, every constraint exists and is VALIDATED on a
 * clean DB, and the obvious bad writes are rejected.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);
const file = readFileSync(join(migrationsDir(), '0032_integrity_checks.sql'), 'utf8');
let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0032 shape' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0032 migration shape', () => {
  it('the SQL file adds exactly the INTEGRITY_CHECKS list (NOT VALID, then guarded VALIDATE)', () => {
    for (const c of INTEGRITY_CHECKS) {
      expect(file, c.name).toContain(`ALTER TABLE "${c.table}" ADD CONSTRAINT "${c.name}" CHECK (${c.expr}) NOT VALID;`);
    }
    const added = [...file.matchAll(/ADD CONSTRAINT "([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(added).toHaveLength(INTEGRITY_CHECKS.length);
    expect(file).toContain('EXCEPTION WHEN check_violation');
  });

  it('every constraint exists and is validated on the migrated test DB', async () => {
    const rows = (await sql`
      select conname, convalidated from pg_constraint where contype = 'c' and conname in ${sql(INTEGRITY_CHECKS.map((c) => c.name))}
    `) as unknown as Array<{ conname: string; convalidated: boolean }>;
    expect(rows).toHaveLength(INTEGRITY_CHECKS.length);
    for (const r of rows) expect(r.convalidated, r.conname).toBe(true);
  });

  it('rejects a VAT rate written as a percentage and a malformed currency', async () => {
    await expect(
      db.update(restaurants).set({ vatRate: '1.5' }).where(eq(restaurants.id, restaurantId)),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(suppliers).values({ restaurantId, name: 'pct', vatRate: '-0.1' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql`insert into invoices (restaurant_id, source, currency) values (${restaurantId}, 'manual', 'ils')`,
    ).rejects.toMatchObject({ code: '23514' });
  });
});
