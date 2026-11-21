import { and, auditLog, desc, eq, sql, supplierCatalogItems, type Database } from '@restomatch/db';
import { IMPORT_COMMITTED_AUDIT_ACTION, IMPORT_RECORD_VERSION, type ImportRowChange, type ItemSnapshot } from './commit';

/** W3-10 · the audit action a revert writes (append-only, like the commit record). */
export const IMPORT_REVERTED_AUDIT_ACTION = 'catalog.import_reverted';

/** NOT_REVERTABLE: a record from before per-row snapshots existed (nothing safe to restore). */
export type RevertError = 'NOT_FOUND' | 'ALREADY_REVERTED' | 'NOT_REVERTABLE';

export type SkipReason = 'CHANGED_SINCE' | 'GONE';

export interface RevertResult {
  /** Rows put back to their pre-import price, unit, pack, product link and times. */
  restored: number;
  /** Rows changed after the import (another import, a hand edit) or deleted: left alone, named. */
  skipped: Array<{ itemId: string; name: string; reason: SkipReason }>;
  /** Rows the import created, now turned off (never deleted). */
  deactivated: number;
}

interface CommitRecord {
  revertVersion?: number;
  commitAt?: string;
  supplierId?: string;
  rowChanges?: ImportRowChange[];
  createdItems?: Array<{ itemId: string; updatedAt: string }>;
}

/** `col IS NOT DISTINCT FROM value` (NULL-safe equality). */
const same = (col: unknown, v: unknown) => sql`${col} is not distinct from ${v}`;

/**
 * W3-10 · undo one committed price-list import from its own audit record.
 *
 * A row is restored only while it is exactly as this import left it: it still
 * carries this import's id, still has the commit's timestamp, and still holds
 * every imported value. Another import (even at the same price) or a hand edit
 * moves one of those, so the later change wins and the row is listed as
 * skipped. Restored together: list price, unit, pack size, product link,
 * active, and the pre-import updated/observed times (so expected-price logic
 * reads the catalog exactly as before). Rows the import created are turned off
 * under the same guard, without touching their times.
 *
 * One transaction with a per-import advisory lock: no double revert, no
 * check-then-write race. Restaurant- and supplier-scoped on every statement.
 * Writes `catalog.import_reverted` with the restored items (from → to), the
 * deactivated ids and the skipped rows. No price_history / baseline writes.
 */
export async function revertCatalogImport(
  db: Database,
  args: { restaurantId: string; importId: string; userId: string | null },
): Promise<RevertResult | RevertError> {
  const { restaurantId: rid, importId } = args;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`catalog-revert:${rid}:${importId}`}))`);
    const scoped = (action: string) =>
      and(eq(auditLog.restaurantId, rid), eq(auditLog.action, action), eq(auditLog.entityId, importId));
    const [record] = await tx
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(scoped(IMPORT_COMMITTED_AUDIT_ACTION))
      .orderBy(desc(auditLog.at))
      .limit(1);
    if (!record) return 'NOT_FOUND' as const;
    const rec = (record.after ?? {}) as CommitRecord;
    if (!rec.supplierId) return 'NOT_FOUND' as const;
    if (rec.revertVersion !== IMPORT_RECORD_VERSION || !rec.commitAt) return 'NOT_REVERTABLE' as const;
    const [done] = await tx.select({ id: auditLog.id }).from(auditLog).where(scoped(IMPORT_REVERTED_AUDIT_ACTION)).limit(1);
    if (done) return 'ALREADY_REVERTED' as const;

    const supplierId = rec.supplierId;
    /** This import still owns the row, untouched since its own last write (exact stamp). */
    const untouched = (stampIso: string) => [
      eq(supplierCatalogItems.restaurantId, rid),
      eq(supplierCatalogItems.supplierId, supplierId),
      eq(supplierCatalogItems.sourceImportId, importId),
      eq(supplierCatalogItems.updatedAt, new Date(stampIso)),
    ];
    const holds = (a: ItemSnapshot) => [
      same(supplierCatalogItems.listPrice, a.listPrice),
      same(supplierCatalogItems.unit, a.unit),
      same(supplierCatalogItems.packSize, a.packSize),
      same(supplierCatalogItems.productId, a.productId),
      eq(supplierCatalogItems.active, a.active),
    ];
    const result: RevertResult = { restored: 0, skipped: [], deactivated: 0 };
    const restoredItems: Array<{ itemId: string; from: ItemSnapshot; to: ItemSnapshot }> = [];
    const classify = async (itemId: string): Promise<SkipReason> => {
      const [row] = await tx
        .select({ id: supplierCatalogItems.id })
        .from(supplierCatalogItems)
        .where(and(eq(supplierCatalogItems.id, itemId), eq(supplierCatalogItems.restaurantId, rid)))
        .limit(1);
      return row ? 'CHANGED_SINCE' : 'GONE';
    };

    for (const c of rec.rowChanges ?? []) {
      const b = c.before;
      const back = await tx
        .update(supplierCatalogItems)
        .set({
          listPrice: b.listPrice,
          unit: b.unit,
          packSize: b.packSize,
          productId: b.productId,
          active: b.active,
          sourceImportId: b.sourceImportId,
          updatedAt: new Date(b.updatedAt),
          observedAt: b.observedAt ? new Date(b.observedAt) : null,
        })
        .where(and(eq(supplierCatalogItems.id, c.itemId), ...untouched(c.after.updatedAt), ...holds(c.after)))
        .returning({ id: supplierCatalogItems.id });
      if (back.length === 1) {
        result.restored += 1;
        const { updatedAt: _stamp, ...from } = c.after;
        restoredItems.push({
          itemId: c.itemId,
          from,
          to: { listPrice: b.listPrice, unit: b.unit, packSize: b.packSize, productId: b.productId, active: b.active },
        });
      } else {
        result.skipped.push({ itemId: c.itemId, name: c.name, reason: await classify(c.itemId) });
      }
    }

    const deactivatedItemIds: string[] = [];
    for (const c of rec.createdItems ?? []) {
      const off = await tx
        .update(supplierCatalogItems)
        .set({ active: false })
        .where(and(eq(supplierCatalogItems.id, c.itemId), ...untouched(c.updatedAt), eq(supplierCatalogItems.active, true)))
        .returning({ id: supplierCatalogItems.id });
      if (off.length === 1) deactivatedItemIds.push(c.itemId);
      else result.skipped.push({ itemId: c.itemId, name: '', reason: await classify(c.itemId) });
    }
    result.deactivated = deactivatedItemIds.length;

    await tx.insert(auditLog).values({
      restaurantId: rid,
      userId: args.userId,
      action: IMPORT_REVERTED_AUDIT_ACTION,
      entityType: 'catalog_import',
      entityId: importId,
      after: { supplierId, restored: result.restored, deactivated: result.deactivated, restoredItems, deactivatedItemIds, skipped: result.skipped },
    });
    return result;
  });
}
