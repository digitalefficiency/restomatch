import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantUsage, createDb, eq, restaurants } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0053_ai_assistant: assistant_usage has a
 * (restaurant, day) primary key, non-negative counters, no text columns and RLS.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0053 shape', businessId: '000000053' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0053 migration shape', () => {
  it('one row per restaurant per day; counters default to 0 and cannot go negative', async () => {
    const [row] = await db.insert(assistantUsage).values({ restaurantId, day: '2026-10-18' }).returning();
    expect(row).toMatchObject({ questions: 0, claudeCalls: 0, costMicroUsd: 0 });
    await expect(db.insert(assistantUsage).values({ restaurantId, day: '2026-10-18' })).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      db.update(assistantUsage).set({ questions: -1 }).where(eq(assistantUsage.restaurantId, restaurantId)),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('stores no free text (no question/answer columns) and has RLS enabled', async () => {
    const cols = (await sql`
      select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'assistant_usage'
    `) as unknown as Array<{ data_type: string }>;
    expect(cols.length).toBe(8);
    expect(cols.some((c) => c.data_type === 'text' || c.data_type.startsWith('character'))).toBe(false);
    const rls = (await sql`
      select relrowsecurity from pg_class where relname = 'assistant_usage'
    `) as unknown as Array<{ relrowsecurity: boolean }>;
    expect(rls).toEqual([{ relrowsecurity: true }]);
  });
});
