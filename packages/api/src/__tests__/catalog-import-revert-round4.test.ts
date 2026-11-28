import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider, recordConfirmedMatch } from '@restomatch/catalog';
import { and, auditLog, catalogImports, createDb, eq, products, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { finalizeFailedImport } from '../catalog/importLifecycle';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · review round 4 (orchestrator 21.11): one import per supplier at a
 * time, "live" expires, a partial summary ranks where its chunks went live,
 * and unit + pack are one basis. Worker-side tests: apps/worker
 * importCatalogLifecycle.db.test.ts.
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
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      filename: 'p.csv',
      status,
      createdBy: A.ownerUserId,
      ...(createdAt ? { createdAt } : {}),
    })
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
    .select({
      id: supplierCatalogItems.id,
      productId: supplierCatalogItems.productId,
      price: supplierCatalogItems.listPrice,
      unit: supplierCatalogItems.unit,
      pack: supplierCatalogItems.packSize,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}
const revert = (id: string) => callerFor(A).catalog.revertImport({ importId: id });
const NOT_LATEST = { code: 'PRECONDITION_FAILED', message: expect.stringContaining('CATALOG_IMPORT_NOT_LATEST') };
const csv = 'sku,name,unit,price\nM,חלב,ק״ג,6\n';
const commitImport = () =>
  callerFor(A).catalog.commitImport({
    supplierId: A.supplierId,
    file: { filename: 'p.csv', text: csv },
    mapping: { sku: 'sku', name: 'name', unit: 'unit', price: 'price' },
    vatBasis: 'ex',
    confirmFlagged: true,
  });
const status = async (id: string) =>
  (await db.select({ s: catalogImports.status }).from(catalogImports).where(eq(catalogImports.id, id)))[0]!.s;

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('round 4 MAJOR 1 · one import per supplier at a time', () => {
  it('a second import while one is live is refused with its reason; nothing is written', async () => {
    await newImportRow('pending'); // a background import of this supplier, queued just now
    await expect(commitImport()).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('CATALOG_IMPORT_RUNNING'),
    });
    const rows = await db.select().from(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, A.restaurantId));
    expect(rows).toEqual([]);
  });

  it('with nothing live the import goes through', async () => {
    const out = await commitImport();
    expect(out).toMatchObject({ queued: false, created: 1 });
  });
});

describe('round 4 MAJOR 2 · "live" expires', () => {
  it('an orphaned pending import blocks neither a revert nor a new import, and ends failed', async () => {
    const c = await importRows([{ sku: 'M', price: 5 }]);
    const orphan = await newImportRow('pending', new Date(Date.now() - 2 * 3_600_000));
    // Not live: the revert of the latest import is not blocked.
    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === c.id)).toMatchObject({ revertable: true });
    await revert(c.id);
    // Nor is a new import; the orphan ends failed on the way.
    await expect(commitImport()).resolves.toMatchObject({ created: 0 });
    expect(await status(orphan)).toBe('failed');
  });
});

describe('round 4 MAJOR 3 · a partial summary ranks where its chunks went live', () => {
  it('A fails part-way, C commits, A is finalized: revert(A) is NOT_LATEST and revert(C) succeeds', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await newImportRow('pending');
    await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: a, chunk: { index: 0, count: 2, size: 1 } },
      [toRow({ sku: 'M', price: 6 })],
      embedder,
    );
    const c = await importRows([{ sku: 'M', price: 7 }]);
    await finalizeFailedImport(db, { restaurantId: A.restaurantId, supplierId: A.supplierId, importId: a }, 'chunk 1 failed');
    const [summary] = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, a), eq(auditLog.action, 'catalog.import_committed')));
    expect(summary!.after).toMatchObject({ partial: true, chunked: 1 });
    await expect(revert(a)).rejects.toMatchObject(NOT_LATEST);
    expect((await revert(c.id)).restored).toBe(1);
    expect(Number((await item('M')).price)).toBe(6);
    expect((await revert(a)).restored).toBe(1);
    expect(Number((await item('M')).price)).toBe(5);
  });
});

describe('round 4 MINOR 4 · unit and pack are one basis', () => {
  it('mapped columns: a new unit with a blank pack stores no pack (not the old case of 12)', async () => {
    await importRows([{ sku: 'M', price: 120, unit: 'ארגז', pack: 12 }]);
    await importRows([{ sku: 'M', price: 10, unit: 'ק״ג', pack: null }]);
    expect(await item('M')).toMatchObject({ unit: 'ק״ג', pack: null });
  });

  it('an unlinked case/12 row with no unit / pack columns goes to review, not to a per-unit product', async () => {
    const [p] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, canonicalName: 'חלב', defaultUnit: 'יח׳' })
      .returning({ id: products.id });
    await recordConfirmedMatch(db, { productId: p!.id, rawName: 'חלב', supplierId: A.supplierId, supplierSku: 'M', provenance: 'exactKey' });
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'M',
      supplierNameRaw: 'חלב',
      unit: 'ארגז',
      packSize: '12',
      listPrice: '120',
    });
    const { res } = await importRows([{ sku: 'M', name: 'חלב', price: 125, unit: null, pack: null }], { unit: false, packSize: false });
    expect((await item('M')).productId).toBeNull();
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0]!.reasons).toContain('UNIT_MISMATCH');
    expect(res.ambiguous[0]!.unit).toBe('ארגז');
  });

  it('the preview shows a kept and a changed unit basis', async () => {
    await importRows([
      { sku: 'K', price: 120, unit: 'ארגז', pack: 12 },
      { sku: 'C', price: 120, unit: 'ארגז', pack: 12 },
    ]);
    const preview = (text: string, mapping: Record<string, string>) =>
      callerFor(A).catalog.parsePreview({ supplierId: A.supplierId, file: { filename: 'p.csv', text }, mapping });
    const kept = await preview('sku,name,price\nK,חלב,125\n', { sku: 'sku', name: 'name', price: 'price' });
    expect(kept.check.rows[0]!.basis).toMatchObject({ change: 'kept', to: { unit: 'ארגז', packSize: '12.000' } });
    const changed = await preview('sku,name,unit,price\nC,חלב,ק״ג,10\n', { sku: 'sku', name: 'name', unit: 'unit', price: 'price' });
    expect(changed.check.rows[0]!.basis).toMatchObject({ change: 'changed', to: { unit: 'ק״ג', packSize: null } });
  });
});
