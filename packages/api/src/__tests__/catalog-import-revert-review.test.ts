import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, auditLog, catalogImports, createDb, eq, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · the money / tenant review of catalog.revertImport (orchestrator 21.11):
 * one test per finding. Each MAJOR test fails on 16983a14 and passes after the fix.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

type Row = { sku: string; name?: string; price: number | null; unit?: string; pack?: number | null };
const toRow = (r: Row) => ({
  supplierSku: r.sku,
  supplierNameRaw: r.name ?? r.sku,
  unit: r.unit ?? 'ק״ג',
  listPrice: r.price,
  barcodeEan: null,
  packSize: r.pack ?? null,
});

async function importRows(rows: Row[]) {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, filename: 'p.csv', status: 'committed', createdBy: A.ownerUserId })
    .returning({ id: catalogImports.id });
  const res = await commitCatalogRows(
    db,
    { restaurantId: A.restaurantId, supplierId: A.supplierId, sourceImportId: imp!.id, userId: A.ownerUserId },
    rows.map(toRow),
    embedder,
  );
  return { id: imp!.id, res };
}

async function item(sku: string) {
  const [r] = await db
    .select({
      id: supplierCatalogItems.id,
      price: supplierCatalogItems.listPrice,
      unit: supplierCatalogItems.unit,
      pack: supplierCatalogItems.packSize,
      active: supplierCatalogItems.active,
      updatedAt: supplierCatalogItems.updatedAt,
    })
    .from(supplierCatalogItems)
    .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
  return r!;
}
const price = async (sku: string) => {
  const p = (await item(sku)).price;
  return p == null ? null : Number(p);
};
const revert = (id: string) => callerFor(A).catalog.revertImport({ importId: id });

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(() => resetDb(db));

describe('review MAJOR 1 · NULL prices', () => {
  it('a blank price cell keeps the existing price (never wipes it) and is counted', async () => {
    await importRows([{ sku: 'M', price: 5.9 }]);
    const { res } = await importRows([{ sku: 'M', price: null }]);
    expect(await price('M')).toBe(5.9);
    expect(res.keptPriceOnBlank).toBe(1);
  });

  it('NULL → ₪X is recorded and the revert writes NULL back', async () => {
    await importRows([{ sku: 'N', price: null }]);
    const b = await importRows([{ sku: 'N', price: 3 }]);
    expect(await price('N')).toBe(3);
    const r = await revert(b.id);
    expect(r.restored).toBe(1);
    expect(await price('N')).toBeNull();
  });
});

describe('review MAJOR 2 · a row hit twice in one import', () => {
  it('reverts to the first old price, not the middle one', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }, { sku: 'M', price: 7 }]);
    expect(await price('M')).toBe(7);
    const r = await revert(b.id);
    expect(r.restored).toBe(1);
    expect(await price('M')).toBe(5);
  });
});

describe('review MAJOR 3 · a later change wins (not by value only)', () => {
  // Round 2 decision: a re-list at the same price writes nothing (no restamp, no
  // ownership), and only the latest import can be undone — so the old puzzle
  // (B owns A's row without recording it) cannot arise.
  it('a newer import at the same price writes nothing; the older one reverts only after it', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'M', price: 6 }]);
    const stampA = (await item('M')).updatedAt.getTime();
    const b = await importRows([{ sku: 'M', price: 6 }]); // B: same ₪
    expect(b.res).toMatchObject({ updated: 0, unchanged: 1 });
    expect((await item('M')).updatedAt.getTime()).toBe(stampA);
    await expect(revert(a.id)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await revert(b.id);
    const r = await revert(a.id);
    expect(r.restored).toBe(1);
    expect(await price('M')).toBe(5);
  });

  it('a hand edit on a row the import created keeps it on', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'NEW', price: 9 }]);
    const created = await item('NEW');
    await callerFor(A).catalog.updateItem({ itemId: created.id, patch: { supplierNameRaw: 'שם מתוקן' } });
    const r = await revert(a.id);
    expect(r.deactivated).toBe(0);
    expect((await item('NEW')).active).toBe(true);
  });
});

describe('review MAJOR 4 · unit / pack / product restored with the price', () => {
  it('a unit-and-pack change is recorded and undone together with the price', async () => {
    await importRows([{ sku: 'M', price: 5, unit: 'ק״ג', pack: null }]);
    const b = await importRows([{ sku: 'M', price: 60, unit: 'ארגז', pack: 12 }]);
    const r = await revert(b.id);
    expect(r.restored).toBe(1);
    const it0 = await item('M');
    expect(Number(it0.price)).toBe(5);
    expect(it0.unit).toBe('ק״ג');
    expect(it0.pack).toBeNull();
  });
});

describe('review MAJOR 5 · the revert does not bump updatedAt', () => {
  it("restores the row's pre-import updatedAt", async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const before = (await item('M')).updatedAt.getTime();
    const b = await importRows([{ sku: 'M', price: 6 }]);
    await revert(b.id);
    expect((await item('M')).updatedAt.getTime()).toBe(before);
  });
});

describe('review MAJOR 6 · a re-import after a revert brings rows back', () => {
  it('a row the revert turned off is active again when a file lists it', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const a = await importRows([{ sku: 'NEW', price: 9 }]);
    await revert(a.id);
    expect((await item('NEW')).active).toBe(false);
    await importRows([{ sku: 'NEW', price: 8 }]);
    const back = await item('NEW');
    expect(back.active).toBe(true);
    expect(Number(back.price)).toBe(8);
  });
});

describe('review MINOR 8 · records from before per-row snapshots', () => {
  it('is not revertable: refused with no audit row, and not offered in the list', async () => {
    const { id } = await importRows([{ sku: 'M', price: 5 }]);
    // Simulate a pre-review record: same action, old shape (no revertVersion / rowChanges).
    await db.delete(auditLog).where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.entityId, id)));
    await db.insert(auditLog).values({
      restaurantId: A.restaurantId,
      action: 'catalog.import_committed',
      entityType: 'catalog_import',
      entityId: id,
      after: { supplierId: A.supplierId, priceChanges: [] },
    });
    await expect(revert(id)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const reverted = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'catalog.import_reverted')));
    expect(reverted).toEqual([]);
    const list = await callerFor(A).catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === id)).toMatchObject({ revertable: false, reverted: false });
  });
});

describe('review MINOR 11 + nit · audit detail and the bookkeeper', () => {
  it('the revert record names each restored row (from → to) and the deactivated ids', async () => {
    await importRows([{ sku: 'M', price: 5 }]);
    const b = await importRows([{ sku: 'M', price: 6 }, { sku: 'NEW', price: 9 }]);
    await revert(b.id);
    const [rec] = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'catalog.import_reverted')));
    const after = rec!.after as { restoredItems: Array<{ from: { listPrice: string }; to: { listPrice: string } }>; deactivatedItemIds: string[] };
    expect(after.restoredItems).toHaveLength(1);
    expect(Number(after.restoredItems[0]!.from.listPrice)).toBe(6);
    expect(Number(after.restoredItems[0]!.to.listPrice)).toBe(5);
    expect(after.deactivatedItemIds).toEqual([(await item('NEW')).id]);
  });

  it('the bookkeeper sees imports but is never offered the revert', async () => {
    const { id } = await importRows([{ sku: 'M', price: 5 }]);
    const list = await callerFor(A, 'bookkeeper').catalog.imports({ supplierId: A.supplierId });
    expect(list.find((i) => i.id === id)).toMatchObject({ revertable: false });
    const own = await callerFor(A, 'manager').catalog.imports({ supplierId: A.supplierId });
    expect(own.find((i) => i.id === id)).toMatchObject({ revertable: true });
  });
});
