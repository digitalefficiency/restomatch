import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, goodsReceipts, purchaseOrders, restaurants, suppliers } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0027_leak_trust (plan v2 T5 pattern): proves the
 * migrated DB carries the 18% VAT default and that the partial unique index
 * really rejects a second goods receipt for the same PO.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;
let poId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0027 shape', businessId: '000000027' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: '0027 supplier' }).returning();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId: s!.id, status: 'sent', source: 'manual', sourcePlatform: 'restomatch' })
    .returning();
  poId = po!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0027 migration shape', () => {
  it('restaurants.vat_rate defaults to 18%', async () => {
    const rows = (await sql`
      select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'restaurants' and column_name = 'vat_rate'
    `) as unknown as Array<{ column_default: string }>;
    expect(rows[0]?.column_default).toContain('0.18');
  });

  it('goods_receipts_po_unique is a partial unique index on (restaurant_id, po_id)', async () => {
    const rows = (await sql`
      select indexdef from pg_indexes where indexname = 'goods_receipts_po_unique'
    `) as unknown as Array<{ indexdef: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0]!.indexdef).toMatch(/\(restaurant_id, po_id\)/);
    expect(rows[0]!.indexdef).toMatch(/WHERE \(po_id IS NOT NULL\)/);
  });

  it('rejects a second receipt for the same PO but allows PO-less receipts', async () => {
    await db.insert(goodsReceipts).values({ restaurantId, poId, status: 'pending' });
    await expect(
      db.insert(goodsReceipts).values({ restaurantId, poId, status: 'pending' }),
    ).rejects.toMatchObject({ code: '23505' });
    await db.insert(goodsReceipts).values({ restaurantId, poId: null, status: 'pending' });
    await db.insert(goodsReceipts).values({ restaurantId, poId: null, status: 'pending' });
  });
});
