import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, memberships, restaurants, translationCache, users } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0052_receiver_languages: preferred_locale accepts the
 * receiver languages (and still rejects anything else); translation_cache exists
 * with its unique key, CHECKs and row-level security.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;
let userId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0052 shape', businessId: '000000052' }).returning();
  restaurantId = r!.id;
  const [u] = await db.insert(users).values({ email: `m0052-${Date.now()}@test.local` }).returning();
  userId = u!.id;
  await db.insert(memberships).values({ restaurantId, userId, role: 'receiver' });
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await db.delete(users).where(eq(users.id, userId));
  await sql.end();
});

describe('0052 migration shape', () => {
  it('memberships.preferred_locale accepts he/en/ar/ru/th/ti/NULL and rejects anything else', async () => {
    const where = and(eq(memberships.restaurantId, restaurantId), eq(memberships.userId, userId));
    for (const locale of ['he', 'en', 'ar', 'ru', 'th', 'ti', null]) {
      await db.update(memberships).set({ preferredLocale: locale }).where(where);
    }
    await expect(db.update(memberships).set({ preferredLocale: 'fr' }).where(where)).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('invitations.preferred_locale accepts a receiver locale', async () => {
    const rows = (await sql`
      select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'invitations_preferred_locale_check'
    `) as unknown as Array<{ def: string }>;
    expect(rows).toHaveLength(1);
    for (const l of ['ar', 'ru', 'th', 'ti']) expect(rows[0]!.def).toContain(`'${l}'`);
  });

  it('translation_cache: one row per (restaurant, locale, source), locale/source CHECKed, RLS on', async () => {
    await db.insert(translationCache).values({
      restaurantId,
      locale: 'ar',
      sourceText: 'עגבניות',
      translatedText: 'طماطم',
      source: 'glossary',
    });
    await expect(
      db.insert(translationCache).values({
        restaurantId,
        locale: 'ar',
        sourceText: 'עגבניות',
        translatedText: 'x',
        source: 'claude',
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(translationCache).values({
        restaurantId,
        locale: 'fr',
        sourceText: 'x',
        translatedText: 'x',
        source: 'glossary',
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(translationCache).values({
        restaurantId,
        locale: 'ru',
        sourceText: 'x',
        translatedText: 'x',
        source: 'model',
      }),
    ).rejects.toMatchObject({ code: '23514' });
    const rls = (await sql`
      select relrowsecurity from pg_class where relname = 'translation_cache'
    `) as unknown as Array<{ relrowsecurity: boolean }>;
    expect(rls).toEqual([{ relrowsecurity: true }]);
    const pol = (await sql`
      select count(*)::int as n from pg_policies where tablename = 'translation_cache'
    `) as unknown as Array<{ n: number }>;
    expect(pol[0]!.n).toBeGreaterThanOrEqual(1);
  });
});
