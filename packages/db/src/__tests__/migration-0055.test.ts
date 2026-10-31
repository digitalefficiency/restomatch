import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, referralCodes, referralRedemptions, restaurants } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0055_referrals: both tables exist with RLS enabled,
 * one code per restaurant, unique codes, one redemption per referred
 * restaurant, no self-referral, and credits only on a 'credited' row.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let a: string;
let b: string;
let c: string;

beforeAll(async () => {
  const rows = await db
    .insert(restaurants)
    .values([
      { name: '0055 A', businessId: '000000551' },
      { name: '0055 B', businessId: '000000552' },
      { name: '0055 C', businessId: '000000553' },
    ])
    .returning();
  [a, b, c] = rows.map((r) => r.id) as [string, string, string];
});

afterAll(async () => {
  await db.delete(restaurants).where(inArray(restaurants.id, [a, b, c]));
  await sql.end();
});

describe('0055 migration shape', () => {
  it('enables RLS on both tables', async () => {
    const rows = (await sql`
      select relname, relrowsecurity from pg_class
      where relname in ('referral_codes', 'referral_redemptions') order by relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean }>;
    expect(rows).toEqual([
      { relname: 'referral_codes', relrowsecurity: true },
      { relname: 'referral_redemptions', relrowsecurity: true },
    ]);
  });

  it('declares the SECURITY DEFINER code resolver', async () => {
    const rows = (await sql`
      select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'resolve_referral_code'
    `) as unknown as Array<{ prosecdef: boolean }>;
    expect(rows).toEqual([{ prosecdef: true }]);
  });

  it('enforces code format, uniqueness and one code per restaurant', async () => {
    await db.insert(referralCodes).values({ restaurantId: a, code: 'AAAA0055' });
    await expect(db.insert(referralCodes).values({ restaurantId: b, code: 'AAAA0055' })).rejects.toMatchObject({
      code: '23505',
    });
    await expect(db.insert(referralCodes).values({ restaurantId: a, code: 'BBBB0055' })).rejects.toMatchObject({
      code: '23505',
    });
    await expect(db.insert(referralCodes).values({ restaurantId: b, code: 'bad-code' })).rejects.toMatchObject({
      code: '23514',
    });
    const [{ id } = { id: null }] = (await sql`select app.resolve_referral_code('aaaa0055') as id`) as unknown as Array<{
      id: string | null;
    }>;
    expect(id).toBe(a);
  });

  it('one redemption per referred restaurant, no self-referral, credit shape', async () => {
    await db.insert(referralRedemptions).values({ code: 'AAAA0055', referrerRestaurantId: a, referredRestaurantId: b });
    await expect(
      db.insert(referralRedemptions).values({ code: 'AAAA0055', referrerRestaurantId: a, referredRestaurantId: b }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(referralRedemptions).values({ code: 'AAAA0055', referrerRestaurantId: c, referredRestaurantId: c }),
    ).rejects.toMatchObject({ code: '23514' });
    // pending rows carry no credit
    await expect(
      db
        .insert(referralRedemptions)
        .values({ code: 'AAAA0055', referrerRestaurantId: a, referredRestaurantId: c, creditAgorotReferred: 100 }),
    ).rejects.toMatchObject({ code: '23514' });
    const [row] = await db
      .update(referralRedemptions)
      .set({ status: 'credited', creditAgorotReferrer: 59_000, creditAgorotReferred: 34_900, creditedAt: new Date() })
      .where(eq(referralRedemptions.referredRestaurantId, b))
      .returning();
    expect(row!.creditAgorotReferrer).toBe(59_000);
  });
});
