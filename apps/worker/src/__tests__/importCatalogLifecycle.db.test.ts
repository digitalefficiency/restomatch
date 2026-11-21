import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appRouter, pendingListDiffs } from '@restomatch/api';
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
  sql,
  type Database,
} from '@restomatch/db';
import {
  MAX_ATTEMPTS,
  MAX_STALLED,
  claimAnySerial,
  failOrphanedCatalogImports,
  insertJob,
  queueSql,
  recoverStalled,
} from '@restomatch/queue';
import type { WorkerJob } from '../queue';
import {
  commitImportInChunks,
  processImportCatalog,
  type CatalogImportJob,
} from '../jobs/importCatalog';
import { runQueuedJobs } from '../serverless';

/**
 * W3-10 review round 3 — the background import's lifecycle: the summary's
 * price changes across chunks, the run budget and the function's end, the
 * continuation job, the last attempt (failed + partial summary), the stall
 * dead-letter, and the chunk size a resumed import keeps.
 */
const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const asDb = db as unknown as Database;
let restaurantId = '';
let userId = '';
let supplierId = '';

beforeAll(() => {
  process.env.DATABASE_URL ??= testDbUrl();
});

async function cleanup() {
  await qsql`DELETE FROM job_queue WHERE queue = 'import-catalog'`;
  if (restaurantId) await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'W3-10 lifecycle' }).returning();
  restaurantId = r!.id;
  const [u] = await db
    .insert(users)
    .values({ email: `w310-life-${Date.now()}@import.test`, name: 'Owner', emailVerified: new Date() })
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
const job = (data: CatalogImportJob, attemptsMade = 0): WorkerJob<CatalogImportJob> => ({
  id: '1',
  name: 'import-catalog',
  data,
  attemptsMade,
  opts: { attempts: MAX_ATTEMPTS['import-catalog']! },
});
const records = (importId: string, action: string) =>
  db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.entityId, importId), eq(auditLog.action, action)));
const chunkIndexes = async (importId: string) =>
  (await records(importId, 'catalog.import_chunk_committed'))
    .map((r) => (r.after as { chunk: { index: number } }).chunk.index)
    .sort();
const importRow = async (importId: string) =>
  (await db.select().from(catalogImports).where(eq(catalogImports.id, importId)))[0]!;
const items = () =>
  db
    .select({ sku: supplierCatalogItems.supplierSku, price: supplierCatalogItems.listPrice, active: supplierCatalogItems.active })
    .from(supplierCatalogItems)
    .where(eq(supplierCatalogItems.restaurantId, restaurantId));

const five: Line[] = [
  ['A1', 'חלב', '5.90'],
  ['A2', 'גבינה', '12'],
  ['A3', 'שמנת', '7.5'],
  ['A4', 'קוטג׳', '6'],
  ['A5', 'יוגורט', '3.2'],
];

describe('round 3 MINOR 4 · the chunked summary merges price changes per row', () => {
  it('one change 5→7 for a row two chunks wrote; a row this import created is no change; announced once', async () => {
    await commitImportInChunks(asDb, await newImport([['M', 'חלב', '5']]));
    const big = await newImport([
      ['M', 'חלב', '6'],
      ['N', 'חדש', '10'],
      ['N', 'חדש', '12'],
      ['M', 'חלב', '7'],
    ]);
    await commitImportInChunks(asDb, big, { chunkRows: 2 });
    const [summary] = await records(big.importId, 'catalog.import_committed');
    const changes = (summary!.after as { priceChanges: Array<{ sku: string; oldListPrice: string; newListPrice: string }> })
      .priceChanges;
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ sku: 'M' });
    expect(Number(changes[0]!.oldListPrice)).toBe(5);
    expect(Number(changes[0]!.newListPrice)).toBe(7);
    const sections = await pendingListDiffs(db, restaurantId, new Date(), 'Asia/Jerusalem');
    expect(sections.filter((s) => s.importId === big.importId)).toHaveLength(1);
    expect(sections.find((s) => s.importId === big.importId)!.top).toHaveLength(1);
  });
});

describe('round 3 MAJOR 2 · the run budget and the function end', () => {
  it('an import job is claimed only with its run budget plus one chunk left', async () => {
    const data = await newImport(five);
    await insertJob(qsql, 'import-catalog', data, { restaurantId, maxAttempts: 3 });
    const short = await runQueuedJobs({ budgetMs: 10_000, queues: ['import-catalog'], importHeadroomMs: 150_000, sql: qsql });
    expect(short).toMatchObject({ ran: 0, stoppedBy: 'budget' });
    expect((await importRow(data.importId)).status).toBe('pending');
    const long = await runQueuedJobs({
      budgetMs: 10_000,
      queues: ['import-catalog'],
      importHeadroomMs: 150_000,
      endsAt: Date.now() + 200_000,
      sql: qsql,
    });
    expect(long).toMatchObject({ ran: 1, done: 1 });
    expect((await importRow(data.importId)).status).toBe('committed');
  });

  it('out of budget: one continuation job is queued and the import stays pending', async () => {
    const data = await newImport(five);
    const queued: CatalogImportJob[] = [];
    const out = await processImportCatalog(job(data), {
      budgetMs: 0,
      chunkRows: 2,
      enqueue: async (d) => {
        queued.push(d);
        return true;
      },
    });
    expect(out).toMatchObject({ continued: 1 });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.importId).toBe(data.importId);
    expect((await importRow(data.importId)).status).toBe('pending');
  });

  it('a continuation that cannot be queued fails the attempt; the import stays pending and the retry resumes', async () => {
    const data = await newImport(five);
    await expect(
      processImportCatalog(job(data), {
        budgetMs: 0,
        chunkRows: 2,
        enqueue: async () => {
          throw new Error('queue down');
        },
      }),
    ).rejects.toThrow('queue down');
    const row = await importRow(data.importId);
    expect(row.status).toBe('pending');
    expect(row.error).toContain('retrying');
    expect(await chunkIndexes(data.importId)).toEqual([0]);
    const retry = await processImportCatalog(job(data, 1), { chunkRows: 2 });
    expect(retry).toMatchObject({ status: 'committed', created: 5 });
    expect(await chunkIndexes(data.importId)).toEqual([0, 1, 2]);
  });
});

describe('round 3 MAJOR 3 · the last attempt and the stall dead-letter', () => {
  it('import-catalog retries (3 attempts)', () => {
    expect(MAX_ATTEMPTS['import-catalog']).toBe(3);
  });

  it('the last attempt ends it failed with a partial summary: the live rise is announced and can be undone', async () => {
    await commitImportInChunks(asDb, await newImport([['M', 'חלב', '5']]));
    const data = await newImport([
      ['M', 'חלב', '6'],
      ['A2', 'גבינה', '12'],
      ['S'.repeat(80), 'שבור', '1'], // supplier_sku is varchar(64): this chunk fails
    ]);
    await expect(processImportCatalog(job(data, 2), { chunkRows: 2 })).rejects.toThrow();
    expect((await importRow(data.importId)).status).toBe('failed');
    const [summary] = await records(data.importId, 'catalog.import_committed');
    expect(summary!.after).toMatchObject({ partial: true, chunked: 1 });
    const sections = await pendingListDiffs(db, restaurantId, new Date(), 'Asia/Jerusalem');
    expect(sections.find((s) => s.importId === data.importId)?.risesCount).toBe(1);
    const r = await owner().catalog.revertImport({ importId: data.importId });
    expect(r).toMatchObject({ restored: 1, deactivated: 1 });
    expect(Number((await items()).find((i) => i.sku === 'M')!.price)).toBe(5);
  });

  it('a job the stall recovery dead-letters marks its import failed and finalizes its partial summary', async () => {
    const data = await newImport(five);
    await commitImportInChunks(asDb, data, { chunkRows: 2, budgetMs: 0 }); // chunk 0 live, then cut
    const [j] = await qsql<Array<{ id: string }>>`
      INSERT INTO job_queue (queue, payload, restaurant_id, status, locked_by, locked_at, stalled_count, attempts, max_attempts)
      VALUES ('import-catalog', ${qsql.json(data as never)}, ${restaurantId}, 'active', 'dead-runner',
              now() - interval '10 minutes', ${MAX_STALLED}, 1, 3)
      RETURNING id`;
    await recoverStalled(qsql, 2 * 60_000);
    expect((await importRow(data.importId)).status).toBe('failed');
    const [fin] = await qsql<Array<{ payload: CatalogImportJob }>>`
      SELECT payload FROM job_queue WHERE queue = 'import-catalog' AND id <> ${j!.id} AND restaurant_id = ${restaurantId}`;
    expect(fin!.payload).toMatchObject({ importId: data.importId, finalize: true });
    expect(fin!.payload.file).toEqual({ filename: 'big.csv' }); // no file carried
    await processImportCatalog(job(fin!.payload));
    const [summary] = await records(data.importId, 'catalog.import_committed');
    expect(summary!.after).toMatchObject({ partial: true, chunked: 1, created: 2 });
    expect((await owner().catalog.imports({ supplierId })).find((i) => i.id === data.importId)).toMatchObject({
      revertable: true,
    });
  });
});

describe('round 3 nit · a resumed import keeps its recorded chunk size', () => {
  it('the second run uses the size the first chunks were recorded with', async () => {
    const data = await newImport(five);
    await commitImportInChunks(asDb, data, { chunkRows: 2, budgetMs: 0 });
    await commitImportInChunks(asDb, data, { chunkRows: 4 });
    expect(await chunkIndexes(data.importId)).toEqual([0, 1, 2]);
    expect(await items()).toHaveLength(5);
  });
});

describe('round 4 MAJOR 1 · a continuation keeps its place in the queue', () => {
  it('is queued at the original run_at and claimed before a job queued after it', async () => {
    const data = { ...(await newImport(five)), queuedAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const other = await newImport([['Z1', 'אחר', '1']]);
    await insertJob(qsql, 'import-catalog', other, { restaurantId, maxAttempts: 3 }); // queued now
    const out = await processImportCatalog(job(data), { budgetMs: 0, chunkRows: 2 });
    expect(out).toMatchObject({ continued: 1 });
    const claimed = await claimAnySerial<CatalogImportJob>(qsql, ['import-catalog'], 'test-runner', 120_000);
    expect(claimed?.payload.importId).toBe(data.importId);
    expect(claimed?.runAt.getTime()).toBe(new Date(data.queuedAt).getTime());
  });
});

describe('round 4 MAJOR 2 · orphaned imports end failed in maintenance', () => {
  it('pending with no job and no progress → failed + one finalize job; one with a queued job is left alone', async () => {
    const orphan = await newImport(five);
    await commitImportInChunks(asDb, orphan, { chunkRows: 2, budgetMs: 0 }); // chunk 0 live
    const old = new Date(Date.now() - 2 * 3_600_000);
    await db.update(catalogImports).set({ createdAt: old }).where(eq(catalogImports.id, orphan.importId));
    await db.execute(sql`update audit_log set at = ${old.toISOString()}::timestamptz where entity_id = ${orphan.importId}::uuid`);
    const waiting = await newImport(five);
    await db.update(catalogImports).set({ createdAt: old }).where(eq(catalogImports.id, waiting.importId));
    await insertJob(qsql, 'import-catalog', waiting, { restaurantId, maxAttempts: 3 });

    expect(await failOrphanedCatalogImports(qsql)).toBe(1);
    expect((await importRow(orphan.importId)).status).toBe('failed');
    expect((await importRow(waiting.importId)).status).toBe('pending');
    const fin = await qsql<Array<{ payload: CatalogImportJob }>>`
      SELECT payload FROM job_queue WHERE queue = 'import-catalog' AND payload ->> 'finalize' = 'true'`;
    expect(fin.map((f) => f.payload.importId)).toEqual([orphan.importId]);
    // Once: a second sweep queues nothing new.
    await failOrphanedCatalogImports(qsql);
    expect((await qsql`SELECT 1 FROM job_queue WHERE queue = 'import-catalog' AND payload ->> 'finalize' = 'true'`).length).toBe(1);
    await processImportCatalog(job(fin[0]!.payload));
    const [summary] = await records(orphan.importId, 'catalog.import_committed');
    expect(summary!.after).toMatchObject({ partial: true, chunked: 1 });
  });
});

describe('round 5 nits · the finalize sweep', () => {
  it('a failed import whose finalize job already ran (here: failed) is not queued again; the count is what was inserted', async () => {
    const data = await newImport(five);
    await commitImportInChunks(asDb, data, { chunkRows: 2, budgetMs: 0 }); // chunk 0 live
    await db.update(catalogImports).set({ status: 'failed' }).where(eq(catalogImports.id, data.importId));
    await qsql`
      INSERT INTO job_queue (queue, payload, restaurant_id, status, dedupe_key, max_attempts, attempts, finished_at)
      VALUES ('import-catalog', ${qsql.json({ importId: data.importId, finalize: true } as never)}, ${restaurantId}, 'failed',
              ${`import-catalog:finalize:${data.importId}`}, 3, 3, now())`;
    expect(await failOrphanedCatalogImports(qsql)).toBe(0);
    const n = await qsql`SELECT 1 FROM job_queue WHERE queue = 'import-catalog' AND payload ->> 'importId' = ${data.importId}`;
    expect(n.length).toBe(1);
  });
});
