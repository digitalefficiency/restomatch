import {
  IMPORT_CHUNK_AUDIT_ACTION,
  commitCatalogRows,
  extractCatalogRows,
  finalizeFailedImport,
  parseCatalogFile,
  recordImportSummary,
} from '@restomatch/api';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, eq, sql, type CatalogColumnMapping, type Database } from '@restomatch/db';
import { CATALOG_IMPORT_RUN_BUDGET_MS, enqueueCatalogImport } from '@restomatch/queue';
import { makeWorker, type WorkerJob } from '../queue';
import { jobDb } from '../db';

/** Background commit of a large supplier price-list import (mirrors the inline tRPC path). */
export interface CatalogImportJob {
  restaurantId: string;
  supplierId: string;
  importId: string;
  file: { filename: string; base64?: string; text?: string };
  mapping: CatalogColumnMapping;
  /**
   * Set only by the queue's stall dead-letter (no file): the import ended
   * failed without its own failure path — write its partial summary.
   */
  finalize?: boolean;
  /** When the import was first queued (ISO): a continuation keeps this place in the queue (round 4). */
  queuedAt?: string;
}

/**
 * Rows per chunk — one transaction and one revert record each (W3-10 review
 * rounds 2–3). Measured locally in ONE transaction: 2,000 new rows 50 s,
 * 20,000 new rows 1,109 s (≈25 → 55 ms/row as the catalog grows). 250 rows
 * stay well inside CATALOG_IMPORT_CHUNK_ALLOWANCE_MS. A resumed import keeps
 * the size its first chunks were recorded with.
 */
export const IMPORT_CHUNK_ROWS = 250;

const embedder = new MockEmbeddingProvider(1536);

export function startImportCatalogWorker() {
  return makeWorker<CatalogImportJob>('import-catalog', processImportCatalog);
}

export type ImportChunksOutcome =
  | { status: 'committed'; chunks: number; created: number; updated: number; unchanged: number; createdProducts: number }
  | { status: 'continue'; nextChunk: number }
  | { status: 'skipped'; reason: 'already committed' | 'reverted' | 'failed' };

const REVERTED = 'catalog.import_reverted';
const COMMITTED = 'catalog.import_committed';

/** This import's records: its chunks (index + size), and whether it has a summary / was reverted. */
async function importRecords(db: Database, restaurantId: string, importId: string) {
  const recs = (await db.execute(sql`
    select action, (after -> 'chunk' ->> 'index')::int as idx, (after -> 'chunk' ->> 'size')::int as size,
           (after -> 'chunk' ->> 'count')::int as count
      from audit_log
     where entity_type = 'catalog_import' and entity_id = ${importId}::uuid and restaurant_id = ${restaurantId}
       and action in (${IMPORT_CHUNK_AUDIT_ACTION}, ${COMMITTED}, ${REVERTED})
  `)) as unknown as Array<{ action: string; idx: number | null; size: number | null; count: number | null }>;
  const chunks = recs.filter((r) => r.action === IMPORT_CHUNK_AUDIT_ACTION);
  return {
    done: new Set(chunks.map((r) => Number(r.idx))),
    size: chunks.find((r) => r.size != null)?.size ?? null,
    count: chunks.find((r) => r.count != null)?.count ?? null,
    summarized: recs.some((r) => r.action === COMMITTED),
    reverted: recs.some((r) => r.action === REVERTED),
  };
}

/**
 * Commit an import chunk by chunk, resuming after the last chunk that has a
 * record (a retry or a continuation never redoes one, and keeps the chunk size
 * the first chunks were recorded with). Each chunk is one transaction that
 * holds the catalog_imports row (FOR UPDATE, id + restaurant), then the
 * supplier lock (inside commitCatalogRows, the same order as a revert), and
 * re-checks first: summarized already, or reverted → stop; this chunk recorded
 * already → skip. The last chunk, in the same transaction, writes the one
 * `catalog.import_committed` summary and sets status = committed — so two runs
 * can never both commit, and a failure mid-chunk leaves nothing of it.
 */
export async function commitImportInChunks(
  db: Database,
  data: CatalogImportJob,
  opts: { chunkRows?: number; budgetMs?: number } = {},
): Promise<ImportChunksOutcome> {
  const { restaurantId, supplierId, importId, file, mapping } = data;
  const budgetMs = opts.budgetMs ?? CATALOG_IMPORT_RUN_BUDGET_MS;
  const t0 = Date.now();

  const table = await parseCatalogFile(file);
  const rows = extractCatalogRows(table, mapping);
  const prior = await importRecords(db, restaurantId, importId);
  const chunkRows = prior.size ?? opts.chunkRows ?? IMPORT_CHUNK_ROWS;
  const count = prior.count ?? Math.max(1, Math.ceil(rows.length / chunkRows));
  let didChunk = false;

  for (let index = 0; index < count; index++) {
    if (didChunk && Date.now() - t0 >= budgetMs) return { status: 'continue', nextChunk: index };
    const step = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;
      const [imp] = await tx
        .select({ status: catalogImports.status })
        .from(catalogImports)
        .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)))
        .for('update');
      if (!imp) {
        throw new Error(`[import-catalog] import=${importId} not found in restaurant=${restaurantId} — refusing to process`);
      }
      if (imp.status === 'committed') return { stop: 'already committed' as const };
      // Failed is final (round 4): the last attempt, the stall dead-letter or
      // expiry ended it — a late job never writes over a newer import.
      if (imp.status === 'failed') return { stop: 'failed' as const };
      const now = await importRecords(tx, restaurantId, importId);
      if (now.reverted) return { stop: 'reverted' as const };
      // A summary means the import ended (committed, or failed and finalized).
      if (now.summarized) return { stop: 'already committed' as const };
      const done = now.done;
      if (!done.has(index)) {
        await commitCatalogRows(
          tx,
          {
            restaurantId,
            supplierId,
            sourceImportId: importId,
            chunk: { index, count, size: chunkRows },
            columns: { unit: !!mapping.unit, packSize: !!mapping.packSize },
          },
          rows.slice(index * chunkRows, (index + 1) * chunkRows),
          embedder,
        );
        done.add(index);
      }
      if (done.size < count) {
        // Determinate progress for the import card: visible after every chunk.
        const [p] = (await tx.execute(sql`
          select coalesce(sum((after ->> 'created')::int), 0)::int as created,
                 coalesce(sum((after ->> 'updated')::int), 0)::int as updated
            from audit_log
           where entity_type = 'catalog_import' and entity_id = ${importId}::uuid and restaurant_id = ${restaurantId}
             and action = ${IMPORT_CHUNK_AUDIT_ACTION}
        `)) as unknown as Array<{ created: number; updated: number }>;
        await tx
          .update(catalogImports)
          .set({ createdItems: p?.created ?? 0, updatedItems: p?.updated ?? 0 })
          .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)));
        return { stop: null };
      }
      const totals = await recordImportSummary(tx, { restaurantId, supplierId, importId });
      await tx
        .update(catalogImports)
        .set({ status: 'committed', error: null, rowCount: rows.length, createdItems: totals.created, updatedItems: totals.updated })
        .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)));
      return { stop: null, totals };
    });
    if (step.stop) return { status: 'skipped', reason: step.stop };
    didChunk = true;
    if ('totals' in step && step.totals) return { status: 'committed', ...step.totals };
  }
  // Every chunk was recorded already but the import is not committed: unreachable
  // (the last chunk's transaction commits it), kept as a loud failure.
  throw new Error(`[import-catalog] import=${importId}: all chunks recorded but not committed`);
}

export interface ProcessImportOptions {
  /** Tests: the run budget (default CATALOG_IMPORT_RUN_BUDGET_MS). */
  budgetMs?: number;
  /** Tests: rows per chunk for a new import. */
  chunkRows?: number;
  /** Tests: how the continuation job is queued. */
  enqueue?: (data: CatalogImportJob) => Promise<boolean>;
}

/** The import-catalog job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processImportCatalog(job: WorkerJob<CatalogImportJob>, opts: ProcessImportOptions = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url) as unknown as Database;
  const { restaurantId, importId } = job.data;

  if (job.data.finalize) {
    await finalizeFailedImport(db, job.data, null);
    return { importId, finalized: true as const };
  }

  // Tenant guard: the import row must belong to the payload's restaurant. Not
  // found may also mean the request that queued this job has not committed yet
  // (the job is queued inside it): thrown, so a later attempt (3, with backoff)
  // finds it (round 3).
  const [imp] = await db
    .select({ id: catalogImports.id, status: catalogImports.status })
    .from(catalogImports)
    .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)))
    .limit(1);
  if (!imp) {
    throw new Error(
      `[import-catalog] import=${importId} not found in restaurant=${restaurantId} — refusing to process`,
    );
  }

  // A producer that timed out (queue database slow, QA D7) falls back to committing the
  // import inline, but the job may still land later — never commit twice (re-checked
  // under the row lock in every chunk).
  if (imp.status === 'committed') {
    return { importId, skipped: 'already committed' as const };
  }
  if (imp.status === 'failed') {
    return { importId, skipped: 'failed' as const };
  }

  try {
    const out = await commitImportInChunks(db, job.data, { budgetMs: opts.budgetMs, chunkRows: opts.chunkRows });
    if (out.status === 'continue') {
      // Out of this run's budget: the rest goes to a fresh job, which resumes at
      // nextChunk. If that cannot be queued, this attempt fails and the queue's
      // retry resumes instead.
      // It keeps the original queue place (run_at = queuedAt), ahead of jobs queued after it.
      const queued = await (
        opts.enqueue ??
        ((d) =>
          enqueueCatalogImport(
            { ...d, mapping: { ...d.mapping } },
            d.queuedAt ? { runAt: new Date(d.queuedAt) } : {},
          ))
      )(job.data);
      if (!queued) throw new Error(`[import-catalog] import=${importId}: the continuation job could not be queued`);
      console.log(`[import-catalog] import=${importId} continues at chunk ${out.nextChunk}`);
      return { importId, continued: out.nextChunk };
    }
    if (out.status === 'skipped') return { importId, skipped: out.reason };
    console.log(
      `[import-catalog] import=${importId} chunks=${out.chunks} created=${out.created} ` +
        `updated=${out.updated} unchanged=${out.unchanged} newProducts=${out.createdProducts}`,
    );
    return { importId, ...out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The chunk that failed left nothing (its transaction rolled back); the
    // chunks before it stay. While attempts remain the import stays pending and
    // the retry resumes it; the last attempt ends it failed (with its partial
    // summary when chunks went live).
    if (job.attemptsMade + 1 >= job.opts.attempts) {
      try {
        await finalizeFailedImport(db, job.data, message);
      } catch (finErr) {
        // Never leave it pending: at least the plain status (the maintenance
        // sweep queues the partial summary later).
        console.error(`[import-catalog] import=${importId}: finalize failed: ${finErr instanceof Error ? finErr.message : finErr}`);
        await db
          .update(catalogImports)
          .set({ status: 'failed', error: message })
          .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)))
          .catch(() => undefined);
      }
    } else {
      await db
        .update(catalogImports)
        .set({ error: `attempt ${job.attemptsMade + 1} failed, retrying: ${message}` })
        .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)));
    }
    throw err;
  }
}
