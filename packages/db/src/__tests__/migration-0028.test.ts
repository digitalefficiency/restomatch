import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, memberships, products, restaurants, suppliers, users } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0028_english_receiving: the English display columns
 * exist, are nullable, round-trip through Drizzle, and preferred_locale only
 * accepts the supported locales.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;
let userId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0028 shape', businessId: '000000028' }).returning();
  restaurantId = r!.id;
  const [u] = await db.insert(users).values({ email: `m0028-${restaurantId}@test.local` }).returning();
  userId = u!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await db.delete(users).where(eq(users.id, userId));
  await sql.end();
});

describe('0028 migration shape', () => {
  it('adds nullable English display columns', async () => {
    const rows = (await sql`
      select table_name, column_name, is_nullable from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('products', 'name_en'), ('suppliers', 'name_en'),
          ('invoice_lines', 'raw_description_en'), ('po_lines', 'raw_description_en'),
          ('memberships', 'preferred_locale'))
      order by table_name, column_name
    `) as unknown as Array<{ table_name: string; column_name: string; is_nullable: string }>;
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      'invoice_lines.raw_description_en',
      'memberships.preferred_locale',
      'po_lines.raw_description_en',
      'products.name_en',
      'suppliers.name_en',
    ]);
    expect(rows.every((r) => r.is_nullable === 'YES')).toBe(true);
  });

  it('round-trips English names through Drizzle', async () => {
    const [s] = await db
      .insert(suppliers)
      .values({ restaurantId, name: 'תנובה', nameEn: 'Tnuva' })
      .returning();
    const [p] = await db
      .insert(products)
      .values({ restaurantId, supplierId: s!.id, canonicalName: 'חלב 3%', nameEn: 'Milk 3%' })
      .returning();
    expect(s!.nameEn).toBe('Tnuva');
    expect(p!.nameEn).toBe('Milk 3%');
  });

  it('preferred_locale accepts he/en/NULL and rejects anything else', async () => {
    await db.insert(memberships).values({ userId, restaurantId, role: 'receiver', preferredLocale: 'en' });
    await db
      .update(memberships)
      .set({ preferredLocale: null })
      .where(eq(memberships.userId, userId));
    await expect(
      db.update(memberships).set({ preferredLocale: 'fr' }).where(eq(memberships.userId, userId)),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
