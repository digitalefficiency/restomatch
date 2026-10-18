import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, posSales, posSalesImports, restaurants } from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0058_pos_sales (wave-1 integrations): both tables
 * exist with restaurant_id (so rls/0002 scopes them), one row per
 * restaurant · day · item, imports cascade to their rows, guards hold.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);
let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0058 shape', businessId: '000000058' }).returning();
  restaurantId = r!.id;
});
afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

async function newImport(from = '2026-10-01', to = '2026-10-02') {
  const [imp] = await db
    .insert(posSalesImports)
    .values({ restaurantId, provider: 'csv', filename: 'z.csv', periodFrom: from, periodTo: to })
    .returning();
  return imp!;
}

describe('0058 migration shape', () => {
  it('both tables carry a NOT NULL restaurant_id (tenant RLS applies)', async () => {
    const rows = (await sql`
      select table_name, is_nullable from information_schema.columns
      where table_schema = 'public' and column_name = 'restaurant_id'
        and table_name in ('pos_sales', 'pos_sales_imports') order by table_name
    `) as unknown as Array<{ table_name: string; is_nullable: string }>;
    expect(rows).toEqual([
      { table_name: 'pos_sales', is_nullable: 'NO' },
      { table_name: 'pos_sales_imports', is_nullable: 'NO' },
    ]);
  });

  it('enables row security with a per-restaurant tenant policy on both tables', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity, p.polname
      from pg_class c left join pg_policy p on p.polrelid = c.oid
      where c.relname in ('pos_sales', 'pos_sales_imports') order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean; polname: string }>;
    expect(rows).toEqual([
      { relname: 'pos_sales', relrowsecurity: true, polname: 'pos_sales_tenant' },
      { relname: 'pos_sales_imports', relrowsecurity: true, polname: 'pos_sales_imports_tenant' },
    ]);
  });

  it('round-trips dates as strings and money/qty as NUMERIC strings', async () => {
    const imp = await newImport();
    const [row] = await db
      .insert(posSales)
      .values({ restaurantId, importId: imp.id, soldOn: '2026-10-01', itemRef: 'D-1', itemName: 'שקשוקה', qty: '12.500', netAmount: '540.00' })
      .returning();
    expect(row).toMatchObject({ soldOn: '2026-10-01', qty: '12.500', netAmount: '540.00' });
  });

  it('one row per restaurant · day · item', async () => {
    const imp = await newImport();
    await expect(
      db.insert(posSales).values({ restaurantId, importId: imp.id, soldOn: '2026-10-01', itemRef: 'D-1', itemName: 'dup', qty: '1', netAmount: '1' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('deleting an import deletes its rows; negative qty and inverted periods are rejected', async () => {
    const imp = await newImport('2026-11-01', '2026-11-01');
    await db.insert(posSales).values({ restaurantId, importId: imp.id, soldOn: '2026-11-01', itemRef: 'D-9', itemName: 'x', qty: '1', netAmount: '10' });
    await db.delete(posSalesImports).where(eq(posSalesImports.id, imp.id));
    expect(await db.select().from(posSales).where(eq(posSales.importId, imp.id))).toHaveLength(0);
    const imp2 = await newImport('2026-11-02', '2026-11-02');
    await expect(
      db.insert(posSales).values({ restaurantId, importId: imp2.id, soldOn: '2026-11-02', itemRef: 'N', itemName: 'x', qty: '-1', netAmount: '1' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(newImport('2026-11-05', '2026-11-01')).rejects.toMatchObject({ code: '23514' });
  });
});
