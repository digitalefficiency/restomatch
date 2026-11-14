import { and, auditLog, desc, eq, inArray, supplierCatalogItems, type Database } from '@restomatch/db';
import { toPriceUnits } from '../lib/parseMoneyCell';
import { IMPORT_COMMITTED_AUDIT_ACTION, type ImportPriceChange } from './commit';

/** W3-10 · the audit action a revert writes (append-only, like the commit record). */
export const IMPORT_REVERTED_AUDIT_ACTION = 'catalog.import_reverted';

export type RevertError = 'NOT_FOUND' | 'ALREADY_REVERTED';

export interface RevertResult {
  /** Rows put back to their old list price. */
  restored: number;
  /** Rows whose price changed again after the import: left as they are, listed. */
  skipped: Array<{ itemId: string | null; name: string; reason: 'CHANGED_SINCE' | 'NO_ITEM_ID' | 'GONE' }>;
  /** Rows the import created, now turned off (never deleted). */
  deactivated: number;
}

/**
 * W3-10 · undo one committed price-list import from its own audit record
 * (`catalog.import_committed`): every list price it changed goes back to the old
 * value — but only where the row still holds the imported price (a later change
 * wins and is listed) — and the rows it created are turned off. Restaurant-
 * scoped on every read and write; one revert per import. Writes a
 * `catalog.import_reverted` audit row. No price_history / baseline writes.
 */
export async function revertCatalogImport(
  db: Database,
  args: { restaurantId: string; importId: string; userId: string | null },
): Promise<RevertResult | RevertError> {
  const { restaurantId: rid, importId } = args;
  const scoped = (action: string) =>
    and(eq(auditLog.restaurantId, rid), eq(auditLog.action, action), eq(auditLog.entityId, importId));
  const [record] = await db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(scoped(IMPORT_COMMITTED_AUDIT_ACTION))
    .orderBy(desc(auditLog.at))
    .limit(1);
  if (!record) return 'NOT_FOUND';
  const [done] = await db.select({ id: auditLog.id }).from(auditLog).where(scoped(IMPORT_REVERTED_AUDIT_ACTION)).limit(1);
  if (done) return 'ALREADY_REVERTED';

  const rec = (record.after ?? {}) as {
    supplierId?: string;
    priceChanges?: ImportPriceChange[];
    createdItemIds?: string[];
  };
  const supplierId = rec.supplierId;
  if (!supplierId) return 'NOT_FOUND';
  const inScope = (id: string) =>
    and(
      eq(supplierCatalogItems.id, id),
      eq(supplierCatalogItems.restaurantId, rid),
      eq(supplierCatalogItems.supplierId, supplierId),
    );

  const result: RevertResult = { restored: 0, skipped: [], deactivated: 0 };
  for (const c of rec.priceChanges ?? []) {
    if (!c.itemId) {
      result.skipped.push({ itemId: null, name: c.name, reason: 'NO_ITEM_ID' });
      continue;
    }
    const [row] = await db
      .select({ listPrice: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(inScope(c.itemId))
      .limit(1);
    if (!row) {
      result.skipped.push({ itemId: c.itemId, name: c.name, reason: 'GONE' });
      continue;
    }
    if (row.listPrice == null || toPriceUnits(Number(row.listPrice)) !== toPriceUnits(Number(c.newListPrice))) {
      result.skipped.push({ itemId: c.itemId, name: c.name, reason: 'CHANGED_SINCE' });
      continue;
    }
    await db
      .update(supplierCatalogItems)
      .set({ listPrice: c.oldListPrice, updatedAt: new Date() })
      .where(inScope(c.itemId));
    result.restored += 1;
  }

  const created = (rec.createdItemIds ?? []).filter((x) => typeof x === 'string');
  if (created.length > 0) {
    const off = await db
      .update(supplierCatalogItems)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          inArray(supplierCatalogItems.id, created),
          eq(supplierCatalogItems.restaurantId, rid),
          eq(supplierCatalogItems.supplierId, supplierId),
          eq(supplierCatalogItems.sourceImportId, importId),
          eq(supplierCatalogItems.active, true),
        ),
      )
      .returning({ id: supplierCatalogItems.id });
    result.deactivated = off.length;
  }

  await db.insert(auditLog).values({
    restaurantId: rid,
    userId: args.userId,
    action: IMPORT_REVERTED_AUDIT_ACTION,
    entityType: 'catalog_import',
    entityId: importId,
    after: { supplierId, ...result },
  });
  return result;
}
