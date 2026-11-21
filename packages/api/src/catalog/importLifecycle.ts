import { and, auditLog, catalogImports, eq, inArray, sql, type Database } from '@restomatch/db';
import { IMPORT_CHUNK_AUDIT_ACTION, IMPORT_COMMITTED_AUDIT_ACTION, recordImportSummary } from './commit';

/**
 * W3-10 review round 4 · one import per supplier at a time, and "live" expires.
 *
 * An import is LIVE while it is pending / mapped and has shown activity within
 * the cutoff: created, or a chunk committed (its chunk record), in the last
 * LIVE_IMPORT_CUTOFF_MINUTES. The tenant connection cannot read job_queue (rls.ts
 * revokes it), so recent activity stands for "has a job": a running import
 * records a chunk at least every CATALOG_IMPORT_CHUNK_ALLOWANCE_MS, and its
 * retries / continuations start within seconds. An import past the cutoff is
 * expired, and expiry is final: expireStaleImports (at a new import of the
 * supplier) and the queue maintenance (failOrphanedCatalogImports, which does
 * see the jobs) mark it failed, and the worker stops at a failed import — so a
 * job that wakes up late can never write over a newer import.
 *
 * Accepted (round 5): an import whose job waits in the queue, or between
 * retries, for more than the cutoff with no activity counts as expired and
 * ends failed. No data risk — the worker stops at a failed import, and its
 * chunks (if any) get the partial summary; the person re-imports.
 */
export const LIVE_IMPORT_CUTOFF_MINUTES = 30;

/** SQL: the import `idExpr` (pending / mapped) has had activity within the cutoff. */
export function importActiveSql(restaurantId: string, idExpr: ReturnType<typeof sql>, createdAtExpr: ReturnType<typeof sql>) {
  return sql`greatest(${createdAtExpr}, coalesce((
      select max(c.at) from audit_log c
       where c.entity_type = 'catalog_import' and c.entity_id = ${idExpr}
         and c.restaurant_id = ${restaurantId} and c.action = ${IMPORT_CHUNK_AUDIT_ACTION}), ${createdAtExpr}))
    > now() - ${LIVE_IMPORT_CUTOFF_MINUTES} * interval '1 minute'`;
}

/**
 * Any import of this supplier still pending / mapped (round 5: no activity
 * condition — after expireStaleImports, one still open is live or held by
 * another transaction).
 */
export async function anyOpenImport(db: Database, restaurantId: string, supplierId: string): Promise<boolean> {
  const rows = (await db.execute(sql`
    select 1 from catalog_imports o
     where o.restaurant_id = ${restaurantId} and o.supplier_id = ${supplierId}::uuid
       and o.status in ('pending', 'mapped')
     limit 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * An import that ends failed (its last attempt threw, the queue gave up on it,
 * or it expired): status failed, and — when chunks went live — the partial
 * `catalog.import_committed` summary, so AU-13 announces the rises that are
 * live and the revert can undo them as one import. Once only: never over a
 * committed, summarized or reverted import. Holds the import row, then the
 * supplier lock (the order every catalog writer uses).
 */
export async function finalizeFailedImport(
  db: Database,
  data: { restaurantId: string; supplierId: string; importId: string },
  error: string | null,
): Promise<void> {
  const { restaurantId, supplierId, importId } = data;
  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database;
    const [imp] = await tx
      .select({ status: catalogImports.status })
      .from(catalogImports)
      .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)))
      .for('update');
    if (!imp || imp.status === 'committed') return;
    await tx
      .update(catalogImports)
      .set({ status: 'failed', ...(error != null ? { error } : {}) })
      .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, restaurantId)));
    const recs = await tx
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.restaurantId, restaurantId),
          eq(auditLog.entityId, importId),
          inArray(auditLog.action, [IMPORT_CHUNK_AUDIT_ACTION, IMPORT_COMMITTED_AUDIT_ACTION, 'catalog.import_reverted']),
        ),
      );
    const chunks = recs.some((r) => r.action === IMPORT_CHUNK_AUDIT_ACTION);
    const ended = recs.some((r) => r.action !== IMPORT_CHUNK_AUDIT_ACTION);
    if (chunks && !ended) {
      // recordImportSummary takes the supplier lock (after this row: the usual order).
      await recordImportSummary(tx, { restaurantId, supplierId, importId, partial: true });
    }
  });
}

/**
 * Expired imports of this supplier (pending / mapped, no activity within the
 * cutoff) end failed now, with their partial summary — lazily, when a new
 * import of the supplier starts. A row someone holds (a worker mid-chunk) is
 * skipped: it is alive. Returns how many ended.
 */
export async function expireStaleImports(db: Database, restaurantId: string, supplierId: string): Promise<number> {
  const stale = (await db.execute(sql`
    select o.id from catalog_imports o
     where o.restaurant_id = ${restaurantId} and o.supplier_id = ${supplierId}::uuid
       and o.status in ('pending', 'mapped')
       and not (${importActiveSql(restaurantId, sql`o.id`, sql`o.created_at`)})
     for update skip locked
  `)) as unknown as Array<{ id: string }>;
  for (const s of stale) {
    await finalizeFailedImport(
      db,
      { restaurantId, supplierId, importId: s.id },
      `expired: no progress for ${LIVE_IMPORT_CUTOFF_MINUTES} minutes`,
    );
  }
  return stale.length;
}
