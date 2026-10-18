import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, invitations, restaurants } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0039_invitation_locale: invitations.preferred_locale
 * exists, is nullable, round-trips through Drizzle and only accepts he/en.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0039 shape', businessId: '000000039' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0039 migration shape', () => {
  it('adds a nullable invitations.preferred_locale column', async () => {
    const rows = (await sql`
      select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'invitations' and column_name = 'preferred_locale'
    `) as unknown as Array<{ is_nullable: string }>;
    expect(rows).toEqual([{ is_nullable: 'YES' }]);
  });

  it('accepts he/en/NULL and rejects anything else', async () => {
    const [inv] = await db
      .insert(invitations)
      .values({
        restaurantId,
        email: 'en-receiver@test.local',
        role: 'receiver',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        preferredLocale: 'en',
      })
      .returning();
    expect(inv!.preferredLocale).toBe('en');
    await db.update(invitations).set({ preferredLocale: null }).where(eq(invitations.id, inv!.id));
    await expect(
      db.update(invitations).set({ preferredLocale: 'fr' }).where(eq(invitations.id, inv!.id)),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
