import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, createDb, eq, supplierCatalogItems, testDbUrl, type Database } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · review round 3 of the price-list import revert (orchestrator 21.11):
 * commit vs revert serialization, a blank unit / pack on a priced row, the
 * name and barcode the import writes, two stacked reverts, and a stamp the
 * 0031 trigger replaces. The worker lifecycle findings are in apps/worker
 * importCatalogLifecycle.db.test.ts.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

type Row = { sku: string; name?: string; price: number | null; unit?: string | null; pack?: number | null; barcode?: string | null };
const toRow = (r: Row) => ({
  supplierSku: r.sku,
  supplierNameRaw: r.name ?? r.sku,
  unit: r.unit === undefined ? 'ק״ג' : r.unit,
  listPrice: r.price,
  barcodeEan: r.barcode ?? null,
  packSize: r.pack ?? null,
});

async function newImportRow(status: 'committed' | 'pending' = 'committed') {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, filename: 'p.csv', status, createdBy: A.ownerUserId })
    .returning({ id: catalogImports.id });
  return imp!.id;
}
async function importRows(rows: Row[], onDb: Database = db) {
  const id = await newImportRow();
  const res = await commitCatalogRows(
    onDb,
    { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: id, userId: A.ownerUserId },
    rows.map(toRow),
    embedder,
  );
  return { id, res };
}
async function item(sku: string) {
  const [r] = await db
    .select({
      id: supplierCatalogItems.id,
      price: supplierCatalogItems.listPrice,
      unit: supplierCatalogItems.unit,
      pack: supplierCatalogItems.packSize,
      name: supplierCatalogItems.supplierNameRaw,
      barcode: supplierCatalogItems.barcodeEan,
      updatedAt: supplierCatalogItems.updatedAt,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}
const price = async (sku: string) => Number((await item(sku)).price);
const revert = (id: string) => callerFor(A).catalog.revertImport({ importId: id });
const NOT_LATEST = { code: 'PRECONDITION_FAILED', message: expect.stringContaining('CATALOG_IMPORT_NOT_LATEST') };

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterEach(() => vi.useRealTimers());
afterAll(() => resetDb(db));

describe('round 3 MAJOR 1 · a commit and a revert never interleave', () => {
  it('a revert that starts while a newer commit is running waits for it, then refuses (NOT_LATEST)', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'M', price: 6 }]);
    const bId = await newImportRow();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // B commits 7 in an open transaction (as the worker's chunk / the inline request does)…
    const b = db.transaction(async (tx) => {
      await commitCatalogRows(
        tx as unknown as Database,
        { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: bId },
        [toRow({ sku: 'M', price: 7 })],
        embedder,
      );
      await gate;
    });
    await new Promise((r) => setTimeout(r, 150));
    // …while the revert of A starts: it must wait on the supplier lock, not run beside B.
    const rev = revert(a.id);
    const settled = await Promise.race([rev.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('waiting'), 300))]);
    expect(settled).toBe('waiting');
    release();
    await b;
    await expect(rev).rejects.toMatchObject(NOT_LATEST);
    expect(await price('M')).toBe(7);
  });

  it('another import of the supplier still on its way (pending) makes this one not the latest', async () => {
    const a = await importRows([{ sku: 'M', price: 5 }]);
    await newImportRow('pending');
    await expect(revert(a.id)).rejects.toMatchObject(NOT_LATEST);
    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === a.id)).toMatchObject({ revertable: false });
  });
});

describe('round 3 MINOR 5 · a blank unit / pack on a priced row keeps the existing one', () => {
  it('120.00 per case of 12 → 125.00 per case of 12, never per unit', async () => {
    await importRows([{ sku: 'M', price: 120, unit: 'ארגז', pack: 12 }]);
    await importRows([{ sku: 'M', price: 125, unit: null, pack: null }]);
    const m = await item('M');
    expect(Number(m.price)).toBe(125);
    expect(m.unit).toBe('ארגז');
    expect(m.pack).toBe('12.000');
  });
});

describe('round 3 MINOR 7 · name and barcode', () => {
  it('a blank barcode cell keeps the barcode', async () => {
    await importRows([{ sku: 'M', price: 5, barcode: '7290000000017' }]);
    const { res } = await importRows([{ sku: 'M', price: 5, barcode: null }]);
    expect((await item('M')).barcode).toBe('7290000000017');
    expect(res).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('a rename plus a new barcode is written, and the revert puts both back', async () => {
    await importRows([{ sku: 'M', name: 'חלב 3%', price: 5, barcode: '7290000000017' }]);
    const b = await importRows([{ sku: 'M', name: 'חלב 3% קרטון', price: 5, barcode: '7290000000024' }]);
    expect(b.res).toMatchObject({ updated: 1 });
    expect(await item('M')).toMatchObject({ name: 'חלב 3% קרטון', barcode: '7290000000024' });
    expect((await revert(b.id)).restored).toBe(1);
    expect(await item('M')).toMatchObject({ name: 'חלב 3%', barcode: '7290000000017' });
  });

  it('a hand edit of the name after the import → CHANGED_SINCE, the edit stays', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }]);
    await callerFor(A).catalog.updateItem({ itemId: (await item('M')).id, patch: { supplierNameRaw: 'שם מתוקן' } });
    const r = await revert(b.id);
    expect(r.skipped).toEqual([expect.objectContaining({ reason: 'CHANGED_SINCE' })]);
    expect(await item('M')).toMatchObject({ name: 'שם מתוקן' });
    expect(await price('M')).toBe(6);
  });
});

describe('round 3 MINOR 7 · stacked reverts and the 0031 trigger', () => {
  it('two imports that both changed the value revert step by step: 7 → 6 → 5', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'M', price: 6 }]);
    const b = await importRows([{ sku: 'M', price: 7 }]);
    await revert(b.id);
    expect(await price('M')).toBe(6);
    await revert(a.id);
    expect(await price('M')).toBe(5);
  });

  it('a stamp equal to the old updated_at is replaced by the trigger; the record holds the stored one and the revert still matches', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const T = new Date('2026-06-01T08:00:00.000Z');
    const id = (await item('M')).id;
    await db.update(supplierCatalogItems).set({ updatedAt: T }).where(eq(supplierCatalogItems.id, id));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T); // the commit's first stamp is T = the row's updated_at
    const b = await importRows([{ sku: 'M', price: 6 }]);
    vi.useRealTimers();
    const stored = (await item('M')).updatedAt;
    expect(stored.getTime()).not.toBe(T.getTime()); // the trigger stamped now()
    const r = await revert(b.id);
    expect(r.restored).toBe(1);
    expect(await price('M')).toBe(5);
    expect((await item('M')).updatedAt.getTime()).toBe(T.getTime());
  });
});
