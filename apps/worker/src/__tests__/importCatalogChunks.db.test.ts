import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@restomatch/api';
import {
  and,
  auditLog,
  catalogImports,
  createDb,
  eq,
  memberships,
  restaurants,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
  users,
  type Database,
} from '@restomatch/db';
import { commitImportInChunks, type CatalogImportJob } from '../jobs/importCatalog';

/**
 * W3-10 review round 2, MINOR 4 + 5 — the background import commits in
 * chunks (one transaction and one revert record each), resumes after the last
 * recorded chunk, can never commit twice, and a failing chunk leaves nothing.
 * The whole chunk set reverts as one import.
 */
const db = createDb(testDbUrl());
let restaurantId = '';
let userId = '';
let supplierId = '';

async function cleanup() {
  if (restaurantId) await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'W3-10 chunks' }).returning();
  restaurantId = r!.id;
  const [u] = await db
    .insert(users)
    .values({ email: `w310-chunks-${Date.now()}@import.test`, name: 'Owner', emailVerified: new Date() })
    .returning();
  userId = u!.id;
  await db.insert(memberships).values({ userId, restaurantId, role: 'owner' });
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'תנובה' }).returning();
  supplierId = s!.id;
});
afterAll(cleanup);

const owner = () =>
  appRouter.createCaller({ db, session: { userId, restaurantId, role: 'owner' } } as Parameters<typeof appRouter.createCaller>[0]);

type Line = [sku: string, name: string, price: string];
async function newImport(lines: Line[]): Promise<CatalogImportJob> {
  const [imp] = await db
    .insert(catalogImports)
    .values({ restaurantId, supplierId, filename: 'big.csv', status: 'pending', createdBy: userId })
    .returning({ id: catalogImports.id });
  const text = ['sku,name,unit,price', ...lines.map(([sku, name, price]) => `${sku},${name},ק״ג,${price}`)].join('\n');
  return {
    restaurantId,
    supplierId,
    importId: imp!.id,
    file: { filename: 'big.csv', text },
    mapping: { sku: 'sku', name: 'name', unit: 'unit', price: 'price' },
  };
}

const records = (importId: string, action: string) =>
  db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.entityId, importId), eq(auditLog.action, action)));
const chunkIndexes = async (importId: string) =>
  (await records(importId, 'catalog.import_chunk_committed'))
    .map((r) => (r.after as { chunk: { index: number } }).chunk.index)
    .sort();
const status = async (importId: string) =>
  (await db.select({ s: catalogImports.status }).from(catalogImports).where(eq(catalogImports.id, importId)))[0]!.s;
const items = () =>
  db
    .select({ sku: supplierCatalogItems.supplierSku, price: supplierCatalogItems.listPrice, active: supplierCatalogItems.active })
    .from(supplierCatalogItems)
    .where(eq(supplierCatalogItems.restaurantId, restaurantId));
const asDb = db as unknown as Database;

const five: Line[] = [
  ['A1', 'חלב', '5.90'],
  ['A2', 'גבינה', '12'],
  ['A3', 'שמנת', '7.5'],
  ['A4', 'קוטג׳', '6'],
  ['A5', 'יוגורט', '3.2'],
];

describe('background import · chunks', () => {
  it('one record per chunk, one summary, committed — and the chunk set reverts as one import', async () => {
    const job = await newImport(five);
    const out = await commitImportInChunks(asDb, job, { chunkRows: 2 });
    expect(out).toMatchObject({ status: 'committed', chunks: 3, created: 5 });
    expect(await chunkIndexes(job.importId)).toEqual([0, 1, 2]);
    const summary = await records(job.importId, 'catalog.import_committed');
    expect(summary).toHaveLength(1);
    expect(summary[0]!.after).toMatchObject({ chunked: 3, created: 5 });
    expect(await status(job.importId)).toBe('committed');

    const r = await owner().catalog.revertImport({ importId: job.importId });
    expect(r.deactivated).toBe(5);
    expect((await items()).every((i) => !i.active)).toBe(true);
  });

  it('a row two chunks wrote goes back to its pre-import price (chunks undone last first)', async () => {
    const first = await newImport([['M', 'חלב', '5']]);
    await commitImportInChunks(asDb, first);
    const job = await newImport([
      ['M', 'חלב', '6'],
      ['X1', 'א', '1'],
      ['M', 'חלב', '7'],
    ]);
    await commitImportInChunks(asDb, job, { chunkRows: 2 });
    expect(Number((await items()).find((i) => i.sku === 'M')!.price)).toBe(7);
    const r = await owner().catalog.revertImport({ importId: job.importId });
    expect(r.restored).toBe(2);
    expect(Number((await items()).find((i) => i.sku === 'M')!.price)).toBe(5);
  });

  it('out of budget → continue; the next run resumes after the last recorded chunk', async () => {
    const job = await newImport(five);
    const a = await commitImportInChunks(asDb, job, { chunkRows: 2, budgetMs: 0 });
    expect(a).toEqual({ status: 'continue', nextChunk: 1 });
    expect(await chunkIndexes(job.importId)).toEqual([0]);
    expect(await status(job.importId)).toBe('pending');
    const b = await commitImportInChunks(asDb, job, { chunkRows: 2 });
    expect(b).toMatchObject({ status: 'committed', created: 5 });
    expect(await chunkIndexes(job.importId)).toEqual([0, 1, 2]);
    expect(await items()).toHaveLength(5);
  });

  it('two runs of the same job never commit twice', async () => {
    const job = await newImport(five);
    const outs = await Promise.all([
      commitImportInChunks(asDb, job, { chunkRows: 2 }),
      commitImportInChunks(asDb, job, { chunkRows: 2 }),
    ]);
    expect(outs.filter((o) => o.status === 'committed')).toHaveLength(1);
    expect(await chunkIndexes(job.importId)).toEqual([0, 1, 2]);
    expect(await records(job.importId, 'catalog.import_committed')).toHaveLength(1);
    expect(await items()).toHaveLength(5);
    // A later run (a retry that lands after the commit) is a no-op.
    expect(await commitImportInChunks(asDb, job, { chunkRows: 2 })).toEqual({ status: 'skipped', reason: 'already committed' });
  });

  it('a failing chunk leaves no rows and no record of it; the failed import reverts as far as it got', async () => {
    const tooLong = 'S'.repeat(80); // supplier_sku is varchar(64): the insert fails
    const job = await newImport([
      ['A1', 'חלב', '5.90'],
      ['A2', 'גבינה', '12'],
      ['A3', 'שמנת', '7.5'],
      [tooLong, 'שבור', '1'],
    ]);
    await expect(commitImportInChunks(asDb, job, { chunkRows: 2 })).rejects.toThrow();
    expect(await chunkIndexes(job.importId)).toEqual([0]);
    expect((await items()).map((i) => i.sku).sort()).toEqual(['A1', 'A2']);
    expect(await records(job.importId, 'catalog.import_committed')).toHaveLength(0);
    // Still committing (no summary, not failed): not revertable yet.
    await expect(owner().catalog.revertImport({ importId: job.importId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // The job's catch marks it failed once the retries run out: then it reverts as far as it got.
    await db.update(catalogImports).set({ status: 'failed' }).where(eq(catalogImports.id, job.importId));
    const r = await owner().catalog.revertImport({ importId: job.importId });
    expect(r.deactivated).toBe(2);
    // A retry after the revert commits nothing more (failed is final, round 4).
    expect(await commitImportInChunks(asDb, job, { chunkRows: 2 })).toEqual({ status: 'skipped', reason: 'failed' });
  });
});
