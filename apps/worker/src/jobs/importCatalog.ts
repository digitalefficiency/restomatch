import {
  IMPORT_CHUNK_AUDIT_ACTION,
  commitCatalogRows,
  extractCatalogRows,
  parseCatalogFile,
  recordImportSummary,
} from '@restomatch/api';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, eq, sql, type CatalogColumnMapping, type Database } from '@restomatch/db';
import { enqueueCatalogImport } from '@restomatch/queue';
import { makeWorker, type WorkerJob } from '../queue';
import { jobDb } from '../db';

/** Background commit of a large supplier price-list import (mirrors the inline tRPC path). */
export interface CatalogImportJob {
  restaurantId: string;
  supplierId: string;
  importId: string;
  file: { filename: string; base64?: string; text?: string };
  mapping: CatalogColumnMapping;
}

/**
 * Rows per chunk — one transaction and one revert record each (W3-10 review
 * round 2). Measured locally at ~25 ms per new row (2,000 rows: 50 s; 20,000
 * rows in one transaction: far past the 300 s function limit), so a chunk of
 * 500 commits in seconds even at several times that latency in production.
 */
export const IMPORT_CHUNK_ROWS = 500;
/**
 * After a chunk, a run that has spent this long hands the rest to a fresh job
 * (the cron route's claim window is 240 s, its function limit 300 s): a long
 * import never gets cut off mid-chunk, and never burns its retries on time.
 */
export const IMPORT_RUN_BUDGET_MS = 120_000;

const embedder = new MockEmbeddingProvider(1536);

export function startImportCatalogWorker() {
  return makeWorker<CatalogImportJob>('import-catalog', processImportCatalog);
}

export type ImportChunksOutcome =
  | { status: 'committed'; chunks: number; created: number; updated: number; unchanged: number; createdProducts: number }
  | { status: 'continue'; nextChunk: number }
  | { status: 'skipped'; reason: 'already committed' | 'reverted' };

/**
 * Commit an import chunk by chunk, resuming after the last chunk that has a
 * record (a retry or a continuation never redoes one). Each chunk is one
 * transaction that holds the catalog_imports row (FOR UPDATE, id + restaurant)
 * and re-checks it first: committed already, or reverted → stop; this chunk
 * recorded already → skip. The last chunk, in the same transaction, writes the
 * one `catalog.import_committed` summary and sets status = committed — so two
 * runs can never both commit, and a failure mid-chunk leaves nothing of it.
 */
export async function commitImportInChunks(
  db: Database,
  data: CatalogImportJob,
  opts: { chunkRows?: number; budgetMs?: number } = {},
): Promise<ImportChunksOutcome> {
  const { restaurantId, supplierId, importId, file, mapping } = data;
  const chunkRows = opts.chunkRows ?? IMPORT_CHUNK_ROWS;
  const budgetMs = opts.budgetMs ?? IMPORT_RUN_BUDGET_MS;
  const t0 = Date.now();

  const table = await parseCatalogFile(file);
  const rows = extractCatalogRows(table, mapping);
  const count = Math.max(1, Math.ceil(rows.length / chunkRows));
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
      const recs = (await tx.execute(sql`
        select action, (after -> 'chunk' ->> 'index')::int as idx
          from audit_log
         where restaurant_id = ${restaurantId} and entity_id = ${importId}::uuid
           and action in (${IMPORT_CHUNK_AUDIT_ACTION}, 'catalog.import_reverted')
      `)) as unknown as Array<{ action: string; idx: number | null }>;
      if (recs.some((r) => r.action === 'catalog.import_reverted')) return { stop: 'reverted' as const };
      const done = new Set(recs.filter((r) => r.action === IMPORT_CHUNK_AUDIT_ACTION).map((r) => Number(r.idx)));
      if (!done.has(index)) {
        await commitCatalogRows(
          tx,
          { restaurantId, supplierId, sourceImportId: importId, chunk: { index, count } },
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
           where restaurant_id = ${restaurantId} and entity_id = ${importId}::uuid
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

/** The import-catalog job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processImportCatalog(job: WorkerJob<CatalogImportJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);
  const { restaurantId, importId } = job.data;

  // Tenant guard: the import row must belong to the payload's restaurant.
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

  try {
    const out = await commitImportInChunks(db as unknown as Database, job.data);
    if (out.status === 'continue') {
      // Out of this run's budget: the rest goes to a fresh job, which resumes at nextChunk.
      await enqueueCatalogImport({ ...job.data, mapping: { ...job.data.mapping } });
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
    // The chunk that failed left nothing (its transaction rolled back); the
    // chunks before it stay and are resumed by the retry. If the retries run
    // out, the import stays failed and can be undone as far as it got.
    await db
      .update(catalogImports)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)));
    throw err;
  }
}
