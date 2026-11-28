import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, createDb, eq, products, sql, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · review round 5 (orchestrator 21.11): a blank / unreadable unit or
 * pack cell carries no information (mapped columns too), units compare with
 * sameUnit, a pack of 1 is no pack, a held stale import still refuses a new
 * one, a product made from a row takes its stored unit, and the preview counts
 * basis changes over all rows.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

type Row = { sku: string; name?: string; price: number | null; unit?: string | null; pack?: number | null };
const toRow = (r: Row) => ({
  supplierSku: r.sku,
  supplierNameRaw: r.name ?? r.sku,
  unit: r.unit === undefined ? 'ק״ג' : r.unit,
  listPrice: r.price,
  barcodeEan: null,
  packSize: r.pack ?? null,
});
async function newImportRow(status: 'committed' | 'pending' = 'committed', createdAt?: Date) {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, filename: 'p.csv', status, createdBy: A.ownerUserId, ...(createdAt ? { createdAt } : {}) })
    .returning({ id: catalogImports.id });
  return imp!.id;
}
async function importRows(rows: Row[], columns?: { unit: boolean; packSize: boolean }) {
  const id = await newImportRow();
  const res = await commitCatalogRows(
    db,
    { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: id, userId: A.ownerUserId, columns },
    rows.map(toRow),
    embedder,
  );
  return { id, res };
}
async function item(sku: string) {
  const [r] = await db
    .select({ productId: supplierCatalogItems.productId, unit: supplierCatalogItems.unit, pack: supplierCatalogItems.packSize })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}
const commitCsv = (text: string, mapping: Record<string, string>) =>
  callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file: { filename: 'p.csv', text }, mapping, vatBasis: 'ex', confirmFlagged: true });

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('round 5 MINOR · unit and pack details', () => {
  it("units compare with sameUnit: יח' and יח׳ are one unit, the pack stays", async () => {
    await importRows([{ sku: 'M', price: 30, unit: "יח'", pack: 6 }]);
    await importRows([{ sku: 'M', price: 32, unit: 'יח׳', pack: null }]);
    expect((await item('M')).pack).toBe('6.000');
  });

  it('a pack of 1 is no pack: not a change', async () => {
    await importRows([{ sku: 'M', price: 5, pack: null }]);
    const { res } = await importRows([{ sku: 'M', price: 5, pack: 1 }]);
    expect(res).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('a product made from an unlinked row takes the unit the row stores, not a blank cell', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'U',
      supplierNameRaw: 'פריט ייחודי',
      unit: 'ארגז',
      packSize: '12',
      listPrice: '120',
    });
    await importRows([{ sku: 'U', name: 'פריט ייחודי', price: 125, unit: null, pack: null }], { unit: false, packSize: false });
    const u = await item('U');
    expect(u.productId).not.toBeNull();
    const [p] = await db.select({ unit: products.defaultUnit }).from(products).where(eq(products.id, u.productId!));
    expect(p!.unit).toBe('ארגז');
  });

  it('the preview counts unit / pack changes over all rows, not the 20 shown', async () => {
    await importRows(Array.from({ length: 25 }, (_, i) => ({ sku: `S${i}`, price: 120, unit: 'ארגז', pack: 12 })));
    const text = ['sku,name,unit,price', ...Array.from({ length: 25 }, (_, i) => `S${i},S${i},ק״ג,10`)].join('\n');
    const p = await callerFor(A).catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text },
      mapping: { sku: 'sku', name: 'name', unit: 'unit', price: 'price' },
    });
    expect(p.check.rows).toHaveLength(20);
    expect(p.check.basisChangedCount).toBe(25);
  });
});

describe('round 5 MINOR · a held stale import still refuses a new one', () => {
  it('a stale pending import another transaction holds (skipped by the expiry) → CATALOG_IMPORT_RUNNING', async () => {
    const stale = await newImportRow('pending', new Date(Date.now() - 2 * 3_600_000));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from catalog_imports where id = ${stale}::uuid for update`);
      locked();
      await gate;
    });
    await isLocked;
    try {
      await expect(commitCsv('sku,name,unit,price\nM,M,ק״ג,6\n', { sku: 'sku', name: 'name', unit: 'unit', price: 'price' })).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('CATALOG_IMPORT_RUNNING'),
      });
    } finally {
      release();
      await holder;
    }
  });
});
