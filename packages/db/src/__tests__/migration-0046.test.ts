import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, products, restaurants, supplierContractPrices, suppliers } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0046_supplier_contract_prices: the table, its
 * same-tenant composite FKs, CHECKs, the (supplier, product, valid_from) key and
 * the updated_at trigger.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let r1: string;
let r2: string;
let s1: string;
let s2: string;
let p1: string;

beforeAll(async () => {
  const [a] = await db.insert(restaurants).values({ name: '0046 A', businessId: '000000461' }).returning();
  const [b] = await db.insert(restaurants).values({ name: '0046 B', businessId: '000000462' }).returning();
  r1 = a!.id;
  r2 = b!.id;
  s1 = (await db.insert(suppliers).values({ restaurantId: r1, name: 'S1' }).returning())[0]!.id;
  s2 = (await db.insert(suppliers).values({ restaurantId: r2, name: 'S2' }).returning())[0]!.id;
  p1 = (await db.insert(products).values({ restaurantId: r1, canonicalName: 'P1' }).returning())[0]!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, r1));
  await db.delete(restaurants).where(eq(restaurants.id, r2));
  await sql.end();
});

const base = () => ({ restaurantId: r1, supplierId: s1, productId: p1, contractPrice: '10.5000', validFrom: '2026-01-01' });

describe('0046 migration shape', () => {
  it('round-trips a row with date strings and NUMERIC(12,4)', async () => {
    const [row] = await db.insert(supplierContractPrices).values({ ...base(), validTo: '2026-12-31', unit: 'kg' }).returning();
    expect(row).toMatchObject({ contractPrice: '10.5000', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'manual' });
    await db.delete(supplierContractPrices).where(eq(supplierContractPrices.id, row!.id));
  });

  it('enforces CHECKs: price ≥ 0, valid_to ≥ valid_from, source enum', async () => {
    await expect(db.insert(supplierContractPrices).values({ ...base(), contractPrice: '-1' })).rejects.toMatchObject({ code: '23514' });
    await expect(db.insert(supplierContractPrices).values({ ...base(), validTo: '2025-12-31' })).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(supplierContractPrices).values({ ...base(), source: 'bogus' as 'manual' }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('unique on (supplier, product, valid_from)', async () => {
    await db.insert(supplierContractPrices).values(base());
    await expect(db.insert(supplierContractPrices).values(base())).rejects.toMatchObject({ code: '23505' });
    await db.delete(supplierContractPrices).where(eq(supplierContractPrices.restaurantId, r1));
  });

  it('composite FKs reject another tenant’s supplier', async () => {
    await expect(db.insert(supplierContractPrices).values({ ...base(), supplierId: s2 })).rejects.toMatchObject({ code: '23503' });
  });

  it('has the updated_at trigger and products(id, restaurant_id) unique', async () => {
    const trg = await sql`select 1 from pg_trigger where tgname = 'supplier_contract_prices_set_updated_at'`;
    expect(trg).toHaveLength(1);
    const uq = await sql`select 1 from pg_constraint where conname = 'products_id_restaurant_id_key'`;
    expect(uq).toHaveLength(1);
  });
});
