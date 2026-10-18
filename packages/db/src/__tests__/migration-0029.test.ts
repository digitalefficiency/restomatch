import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, inArray, purchaseOrders, restaurants, suppliers } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Shape test for 0029_tenant_scoped_uniques (I5): the platform-ref uniques are
 * per restaurant. Two tenants on the same MarketMan account space may hold the
 * same supplier/PO reference; one tenant still cannot hold it twice.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);
const ids: string[] = [];

beforeAll(async () => {
  const rows = await db
    .insert(restaurants)
    .values([{ name: '0029 A' }, { name: '0029 B' }])
    .returning({ id: restaurants.id });
  ids.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await db.delete(restaurants).where(inArray(restaurants.id, ids));
  await sql.end();
});

describe('0029 migration shape', () => {
  it('replaces the global uniques with (restaurant_id, platform, ref)', async () => {
    const rows = (await sql`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename in ('purchase_orders', 'suppliers')
    `) as unknown as Array<{ indexname: string; indexdef: string }>;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.has('po_source_ref_unique')).toBe(false);
    expect(byName.has('suppliers_external_ref_unique')).toBe(false);
    expect(byName.get('po_restaurant_source_ref_unique')).toMatch(/UNIQUE INDEX .*\(restaurant_id, source_platform, source_ref\)/);
    expect(byName.get('suppliers_restaurant_external_ref_unique')).toMatch(
      /UNIQUE INDEX .*\(restaurant_id, source_platform, external_ref\)/,
    );
  });

  it('lets two restaurants share a platform ref but not one restaurant twice', async () => {
    const [a, b] = ids as [string, string];
    const [sa] = await db
      .insert(suppliers)
      .values({ restaurantId: a, name: 'A', sourcePlatform: 'marketman', externalRef: 'shared-sup' })
      .returning();
    const [sb] = await db
      .insert(suppliers)
      .values({ restaurantId: b, name: 'B', sourcePlatform: 'marketman', externalRef: 'shared-sup' })
      .returning();
    await db.insert(purchaseOrders).values([
      { restaurantId: a, supplierId: sa!.id, source: 'platform', sourcePlatform: 'marketman', sourceRef: 'shared-po' },
      { restaurantId: b, supplierId: sb!.id, source: 'platform', sourcePlatform: 'marketman', sourceRef: 'shared-po' },
    ]);
    await expect(
      db.insert(purchaseOrders).values({
        restaurantId: a,
        supplierId: sa!.id,
        source: 'platform',
        sourcePlatform: 'marketman',
        sourceRef: 'shared-po',
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(suppliers).values({ restaurantId: a, name: 'A2', sourcePlatform: 'marketman', externalRef: 'shared-sup' }),
    ).rejects.toMatchObject({ code: '23505' });
    // Manual rows (NULL refs) stay unconstrained.
    await db.insert(suppliers).values([
      { restaurantId: a, name: 'manual 1' },
      { restaurantId: a, name: 'manual 2' },
    ]);
  });
});
