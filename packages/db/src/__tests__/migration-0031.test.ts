import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants, suppliers } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Shape test for 0031_updated_at_triggers: every table with an updated_at column
 * carries the set_updated_at trigger, and the trigger bumps the timestamp unless
 * the UPDATE sets it explicitly.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);
let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0031 shape' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0031 migration shape', () => {
  it('every updated_at table has a <table>_set_updated_at trigger', async () => {
    const rows = (await sql`
      select c.table_name as t,
             exists (select 1 from pg_trigger g
                     where g.tgrelid = ('public.' || c.table_name)::regclass
                       and g.tgname = c.table_name || '_set_updated_at') as has
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'updated_at'
    `) as unknown as Array<{ t: string; has: boolean }>;
    expect(rows.length).toBeGreaterThanOrEqual(13);
    for (const r of rows) expect(r.has, r.t).toBe(true);
  });

  it('bumps updated_at on UPDATE, but keeps an explicitly written value', async () => {
    const old = new Date('2024-01-01T00:00:00Z');
    const [s] = await db.insert(suppliers).values({ restaurantId, name: 'trg', updatedAt: old }).returning();
    expect(s!.updatedAt.toISOString()).toBe(old.toISOString());
    const [bumped] = await db.update(suppliers).set({ name: 'trg 2' }).where(eq(suppliers.id, s!.id)).returning();
    expect(bumped!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    const pinned = new Date('2025-06-01T00:00:00Z');
    const [kept] = await db
      .update(suppliers)
      .set({ name: 'trg 3', updatedAt: pinned })
      .where(eq(suppliers.id, s!.id))
      .returning();
    expect(kept!.updatedAt.toISOString()).toBe(pinned.toISOString());
  });
});
