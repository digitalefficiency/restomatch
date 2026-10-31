import { commitCatalogRows, extractCatalogRows, parseCatalogFile } from '@restomatch/api';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { and, catalogImports, eq, type CatalogColumnMapping } from '@restomatch/db';
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

const embedder = new MockEmbeddingProvider(1536);

export function startImportCatalogWorker() {
  return makeWorker<CatalogImportJob>('import-catalog', processImportCatalog);
}

/** The import-catalog job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processImportCatalog(job: WorkerJob<CatalogImportJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);
  const { restaurantId, supplierId, importId, file, mapping } = job.data;

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
  // import inline, but the job may still land later — never commit twice.
  if (imp.status === 'committed') {
    return { importId, skipped: 'already committed' as const };
  }

  try {
    const table = await parseCatalogFile(file);
    const rows = extractCatalogRows(table, mapping);
    const result = await commitCatalogRows(
      db,
      { restaurantId, supplierId, sourceImportId: importId },
      rows,
      embedder,
    );
    await db
      .update(catalogImports)
      .set({
        status: 'committed',
        rowCount: rows.length,
        createdItems: result.created,
        updatedItems: result.updated,
      })
      .where(eq(catalogImports.id, importId));
    console.log(
      `[import-catalog] import=${importId} rows=${rows.length} created=${result.created} ` +
        `updated=${result.updated} newProducts=${result.createdProducts} ambiguous=${result.ambiguous.length}`,
    );
    return { importId, ...result };
  } catch (err) {
    await db
      .update(catalogImports)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(eq(catalogImports.id, importId));
    throw err;
  }
}
