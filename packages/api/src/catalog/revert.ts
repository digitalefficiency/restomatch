import { and, auditLog, catalogImports, eq, inArray, sql, supplierCatalogItems, type Database } from '@restomatch/db';
import { recordAudit } from '../audit';
import {
  IMPORT_CHUNK_AUDIT_ACTION,
  IMPORT_COMMITTED_AUDIT_ACTION,
  IMPORT_RECORD_VERSION,
  lockSupplierCatalog,
  type ImportRowChange,
  type ItemSnapshot,
} from './commit';

/** W3-10 · the audit action a revert writes (append-only, like the commit record). */
export const IMPORT_REVERTED_AUDIT_ACTION = 'catalog.import_reverted';

/**
 * NOT_REVERTABLE: no record a revert can trust — from before per-row snapshots,
 * committed twice, a chunk set with a gap, or a background import still
 * committing. NOT_LATEST: a later import of the same supplier is still in
 * place; only the most recent one can be undone ("ביטול הייבוא האחרון").
 */
export type RevertError = 'NOT_FOUND' | 'ALREADY_REVERTED' | 'NOT_REVERTABLE' | 'NOT_LATEST';

export type SkipReason = 'CHANGED_SINCE' | 'GONE';

export interface RevertResult {
  /** Rows put back to their pre-import price, unit, pack, product link, name, barcode and times. */
  restored: number;
  /** Rows changed after the import (a hand edit) or deleted: left alone, named. */
  skipped: Array<{ itemId: string; name: string; reason: SkipReason }>;
  /** Rows the import created, now turned off (never deleted). */
  deactivated: number;
}

/** One commit record: the whole import (inline) or one chunk of a background import. */
interface CommitRecord {
  revertVersion?: number;
  commitAt?: string;
  supplierId?: string;
  chunk?: { index: number; count: number };
  /** On the summary of a chunked import: how many chunk records carry the revert data. */
  chunked?: number;
  /** A summary written when the import ended failed part-way (its chunks are the ones that went live). */
  partial?: boolean;
  rowChanges?: ImportRowChange[];
  createdItems?: Array<{ itemId: string; updatedAt: string }>;
}

/** `col IS NOT DISTINCT FROM value` (NULL-safe equality). */
const same = (col: unknown, v: unknown) => sql`${col} is not distinct from ${v}`;

/** The commit records of one import (summary or single record, and chunks), or why there is none to trust. */
function revertUnits(
  committed: CommitRecord[],
  chunks: CommitRecord[],
  status: string,
): CommitRecord[] | 'NOT_FOUND' | 'NOT_REVERTABLE' {
  if (committed.length === 0 && chunks.length === 0) return 'NOT_FOUND';
  // A second import_committed record means the import was committed twice.
  if (committed.length > 1) return 'NOT_REVERTABLE';
  const all = [...committed, ...chunks];
  if (all.some((r) => r.revertVersion !== IMPORT_RECORD_VERSION || !r.supplierId)) return 'NOT_REVERTABLE';
  const summary = committed[0];
  if (chunks.length === 0) {
    // The whole import in one record (inline commit).
    return summary && summary.chunked == null && summary.commitAt ? [summary] : 'NOT_REVERTABLE';
  }
  // A chunked import: exactly one record per chunk 0..k-1, one count, one supplier.
  const sorted = [...chunks].sort((a, b) => (a.chunk?.index ?? -1) - (b.chunk?.index ?? -1));
  const count = sorted[0]?.chunk?.count;
  const contiguous = sorted.every(
    (r, i) => r.chunk?.index === i && r.chunk.count === count && r.supplierId === sorted[0]!.supplierId,
  );
  if (!contiguous || count == null) return 'NOT_REVERTABLE';
  if (summary?.partial) {
    // Ended failed part-way: the chunks that went live, 0..k-1 of the planned count.
    if (status !== 'failed' || summary.chunked !== sorted.length || count < sorted.length) return 'NOT_REVERTABLE';
  } else if (summary) {
    if (summary.chunked !== sorted.length || count !== sorted.length) return 'NOT_REVERTABLE';
  } else if (status !== 'failed') {
    // No summary yet: still committing. A failed one is undone as far as it got.
    return 'NOT_REVERTABLE';
  }
  // Undo the last chunk first: a row two chunks wrote goes back step by step.
  return sorted.reverse();
}

/**
 * W3-10 · undo the most recent committed price-list import of a supplier from
 * its own audit record(s).
 *
 * A row is restored only while it is exactly as this import left it: it still
 * carries this import's id, still has the stamp of the import's last write to
 * it, and still holds every written value. A hand edit moves one of those, so
 * the edit wins and the row is listed as skipped. Restored together: list
 * price, unit, pack size, product link, name, barcode, active, and the
 * pre-import updated / observed times (so expected-price logic reads the
 * catalog exactly as before). Rows the import created are turned off under the
 * same guard; turning one off moves its updated_at (the 0031 trigger), and the
 * stamp it gets is recorded so a re-import can bring it back only while it is
 * still exactly so.
 *
 * Only the latest un-reverted import of the supplier can be undone (round 2):
 * an older one is refused (NOT_LATEST) with no audit row. One transaction,
 * holding the import row (FOR UPDATE, which also waits out a worker chunk) and
 * then the per-supplier lock every commit takes (lockSupplierCatalog): no double
 * revert, no commit between the checks and the writes, no lock cycle.
 * Restaurant- and supplier-scoped on every statement. Writes
 * `catalog.import_reverted`. No price_history / baseline writes.
 */
export async function revertCatalogImport(
  db: Database,
  args: { restaurantId: string; importId: string; userId: string | null },
): Promise<RevertResult | RevertError> {
  const { restaurantId: rid, importId } = args;
  return db.transaction(async (tx) => {
    const [imp] = await tx
      .select({ supplierId: catalogImports.supplierId, status: catalogImports.status })
      .from(catalogImports)
      .where(and(eq(catalogImports.id, importId), eq(catalogImports.restaurantId, rid)))
      .for('update');
    if (!imp) return 'NOT_FOUND' as const;
    const supplierId = imp.supplierId;
    // The supplier lock every commit takes too (round 3): no commit runs between
    // this revert's checks and its writes, and none reads a row it is restoring.
    await lockSupplierCatalog(tx as unknown as Database, rid, supplierId);

    const scoped = (actions: string[]) =>
      and(eq(auditLog.restaurantId, rid), inArray(auditLog.action, actions), eq(auditLog.entityId, importId));
    const records = await tx
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(scoped([IMPORT_COMMITTED_AUDIT_ACTION, IMPORT_CHUNK_AUDIT_ACTION, IMPORT_REVERTED_AUDIT_ACTION]));
    if (records.some((r) => r.action === IMPORT_REVERTED_AUDIT_ACTION)) return 'ALREADY_REVERTED' as const;
    const of = (action: string) =>
      records.filter((r) => r.action === action).map((r) => (r.after ?? {}) as CommitRecord);
    const units = revertUnits(of(IMPORT_COMMITTED_AUDIT_ACTION), of(IMPORT_CHUNK_AUDIT_ACTION), imp.status);
    if (typeof units === 'string') return units;
    if (units.some((u) => u.supplierId !== supplierId)) return 'NOT_REVERTABLE' as const;

    // Stack semantics: this is no longer the latest import when another import
    // of the supplier is still on its way (pending / mapped), or committed later
    // and is not reverted. "Later" is the commit-order stamp each record takes
    // under the supplier lock (lockedAt), never a transaction-start time.
    const later = (await tx.execute(sql`
      select 1 from catalog_imports o
       where o.restaurant_id = ${rid} and o.supplier_id = ${supplierId}::uuid
         and o.id <> ${importId}::uuid and o.status in ('pending', 'mapped')
      union all
      select 1 from audit_log l
       where l.restaurant_id = ${rid}
         and l.action in (${IMPORT_COMMITTED_AUDIT_ACTION}, ${IMPORT_CHUNK_AUDIT_ACTION})
         and l.after ->> 'supplierId' = ${supplierId}
         and l.entity_id is distinct from ${importId}::uuid
         and coalesce((l.after ->> 'lockedAt')::timestamptz, l.at) >
             (select max(coalesce((m.after ->> 'lockedAt')::timestamptz, m.at)) from audit_log m
               where m.restaurant_id = ${rid} and m.entity_id = ${importId}::uuid
                 and m.action in (${IMPORT_COMMITTED_AUDIT_ACTION}, ${IMPORT_CHUNK_AUDIT_ACTION}))
         and not exists (select 1 from audit_log r
                          where r.restaurant_id = ${rid} and r.action = ${IMPORT_REVERTED_AUDIT_ACTION}
                            and r.entity_id = l.entity_id)
       limit 1
    `)) as unknown as unknown[];
    if (later.length > 0) return 'NOT_LATEST' as const;

    /** This import still owns the row, untouched since its own last write (exact stamp, at ms). */
    const untouched = (stampIso: string) => [
      eq(supplierCatalogItems.restaurantId, rid),
      eq(supplierCatalogItems.supplierId, supplierId),
      eq(supplierCatalogItems.sourceImportId, importId),
      sql`date_trunc('milliseconds', ${supplierCatalogItems.updatedAt}) = ${stampIso}::timestamptz`,
    ];
    const holds = (a: ItemSnapshot) => [
      same(supplierCatalogItems.listPrice, a.listPrice),
      same(supplierCatalogItems.unit, a.unit),
      same(supplierCatalogItems.packSize, a.packSize),
      same(supplierCatalogItems.productId, a.productId),
      eq(supplierCatalogItems.active, a.active),
      eq(supplierCatalogItems.supplierNameRaw, a.supplierNameRaw),
      same(supplierCatalogItems.barcodeEan, a.barcodeEan),
    ];
    const classify = async (itemId: string): Promise<SkipReason> => {
      const [row] = await tx
        .select({ id: supplierCatalogItems.id })
        .from(supplierCatalogItems)
        .where(and(eq(supplierCatalogItems.id, itemId), eq(supplierCatalogItems.restaurantId, rid)))
        .limit(1);
      return row ? 'CHANGED_SINCE' : 'GONE';
    };

    const result: RevertResult = { restored: 0, skipped: [], deactivated: 0 };
    const restoredItems: Array<{
      itemId: string;
      from: ImportRowChange['after'] & { sourceImportId: string };
      to: ImportRowChange['before'];
    }> = [];
    const deactivatedItems: Array<{ itemId: string; updatedAt: string }> = [];

    for (const unit of units) {
      for (const c of unit.rowChanges ?? []) {
        const b = c.before;
        const back = await tx
          .update(supplierCatalogItems)
          .set({
            listPrice: b.listPrice,
            unit: b.unit,
            packSize: b.packSize,
            productId: b.productId,
            active: b.active,
            supplierNameRaw: b.supplierNameRaw,
            barcodeEan: b.barcodeEan,
            sourceImportId: b.sourceImportId,
            updatedAt: new Date(b.updatedAt),
            observedAt: b.observedAt ? new Date(b.observedAt) : null,
          })
          .where(and(eq(supplierCatalogItems.id, c.itemId), ...untouched(c.after.updatedAt), ...holds(c.after)))
          .returning({ id: supplierCatalogItems.id });
        if (back.length === 1) {
          result.restored += 1;
          restoredItems.push({ itemId: c.itemId, from: { ...c.after, sourceImportId: importId }, to: b });
        } else {
          result.skipped.push({ itemId: c.itemId, name: c.name, reason: await classify(c.itemId) });
        }
      }
      for (const c of unit.createdItems ?? []) {
        const [off] = await tx
          .update(supplierCatalogItems)
          .set({ active: false })
          .where(
            and(eq(supplierCatalogItems.id, c.itemId), ...untouched(c.updatedAt), eq(supplierCatalogItems.active, true)),
          )
          .returning({ updatedAt: supplierCatalogItems.updatedAt });
        if (off) deactivatedItems.push({ itemId: c.itemId, updatedAt: off.updatedAt.toISOString() });
        else result.skipped.push({ itemId: c.itemId, name: '', reason: await classify(c.itemId) });
      }
    }
    result.deactivated = deactivatedItems.length;

    await recordAudit(tx as unknown as Database, {
      restaurantId: rid,
      userId: args.userId,
      action: IMPORT_REVERTED_AUDIT_ACTION,
      entityType: 'catalog_import',
      entityId: importId,
      after: {
        supplierId,
        restored: result.restored,
        deactivated: result.deactivated,
        restoredItems,
        deactivatedItemIds: deactivatedItems.map((d) => d.itemId),
        /** With the stamp the revert left: a re-import turns a row back on only while it still has it. */
        deactivatedItems,
        skipped: result.skipped,
      },
    });
    return result;
  });
}
