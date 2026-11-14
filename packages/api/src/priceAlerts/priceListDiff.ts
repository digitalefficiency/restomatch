import { and, auditLog, eq, gt, inArray, suppliers, type Database } from '@restomatch/db';
import { localDateKey } from '../contracts/core';
import type { ListDiffSection } from './digest';

/**
 * AU-13 AC 5 — "מחירון חדש מתנובה (12.11): 12 מחירים עלו · …".
 *
 * Reads ONE record per committed price-list import: an `audit_log` row
 * `catalog.import_committed` whose `after` carries
 * `{ supplierId, priceChanges: [{ name, sku, oldListPrice, newListPrice, unit }] }`.
 * The catalog owner writes that record at commit time (G-08 / W3-10 request; no
 * schema change). Until it does, this reader finds nothing and the section is
 * omitted.
 *
 * Read only: no AU-13 path writes `price_history` or `price_baselines` (AD11 —
 * list prices must keep staying out of the baselines). No ₪/month here: a list
 * price carries no quantity, and multiplying by another unit's invoice qty is
 * wrong.
 */
export const IMPORT_COMMITTED_AUDIT = 'catalog.import_committed';
export const LIST_DIFF_AUDIT = 'prices.list_diff_notified';
/** Imports older than this are not announced in the morning mail. */
export const LIST_DIFF_LOOKBACK_DAYS = 7;
const TOP = 5;

export interface PriceChange {
  name: string;
  sku?: string | null;
  oldListPrice: number | string | null;
  newListPrice: number | string | null;
  unit?: string | null;
}

/** Basis points of the old price, half-up; null when not a comparable rise. */
function riseBp(oldP: number, newP: number): number | null {
  if (!(oldP > 0) || !(newP > oldP)) return null;
  // Integer price units (1/10000 ₪) so 5.90 → 6.08 is exactly 305 bp.
  const o = Math.round(oldP * 10_000);
  const n = Math.round(newP * 10_000);
  return Math.floor(((n - o) * 10_000 * 2 + o) / (2 * o));
}

/** Pure: the section for one import, or null when nothing rose. */
export function listDiffSection(args: {
  importId: string;
  supplierName: string;
  importedOn: string;
  changes: readonly PriceChange[];
}): ListDiffSection | null {
  const rises = args.changes
    .map((c) => {
      const oldP = Number(c.oldListPrice);
      const newP = Number(c.newListPrice);
      const bp = c.oldListPrice == null || c.newListPrice == null ? null : riseBp(oldP, newP);
      return bp == null ? null : { name: c.name, oldListPrice: oldP, newListPrice: newP, changeBp: bp };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rises.length === 0) return null;
  const sum = rises.reduce((s, r) => s + r.changeBp, 0);
  return {
    importId: args.importId,
    supplierName: args.supplierName,
    importedOn: args.importedOn,
    risesCount: rises.length,
    avgRiseBp: Math.floor((sum * 2 + rises.length) / (2 * rises.length)),
    top: [...rises].sort((a, b) => b.changeBp - a.changeBp || a.name.localeCompare(b.name, 'he')).slice(0, TOP),
  };
}

/** Recent committed imports with rises, not yet announced. Restaurant-scoped. */
export async function pendingListDiffs(db: Database, restaurantId: string, now: Date, tz: string): Promise<ListDiffSection[]> {
  const since = new Date(now.getTime() - LIST_DIFF_LOOKBACK_DAYS * 86_400_000);
  const imports = await db
    .select({ id: auditLog.id, entityId: auditLog.entityId, after: auditLog.after, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, IMPORT_COMMITTED_AUDIT), gt(auditLog.at, since)));
  if (imports.length === 0) return [];
  const announced = new Set(
    (
      await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, LIST_DIFF_AUDIT)))
    ).map((r) => (r.after as { importId?: string } | null)?.importId ?? ''),
  );
  const todo = imports
    .map((i) => ({ ...i, importId: i.entityId ?? i.id, rec: (i.after ?? {}) as { supplierId?: string; priceChanges?: PriceChange[] } }))
    .filter((i) => !announced.has(i.importId) && i.rec.supplierId && Array.isArray(i.rec.priceChanges));
  if (todo.length === 0) return [];
  const names = new Map(
    (
      await db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.restaurantId, restaurantId), inArray(suppliers.id, [...new Set(todo.map((t) => t.rec.supplierId!))])))
    ).map((s) => [s.id, s.name]),
  );
  return todo
    .filter((t) => names.has(t.rec.supplierId!))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((t) =>
      listDiffSection({ importId: t.importId, supplierName: names.get(t.rec.supplierId!)!, importedOn: localDateKey(t.at, tz), changes: t.rec.priceChanges! }),
    )
    .filter((s): s is ListDiffSection => s !== null);
}

export async function markListDiffsAnnounced(db: Database, restaurantId: string, sections: readonly ListDiffSection[]): Promise<void> {
  if (sections.length === 0) return;
  await db.insert(auditLog).values(
    sections.map((s) => ({
      restaurantId,
      userId: null,
      action: LIST_DIFF_AUDIT,
      entityType: 'catalog_import',
      entityId: null,
      after: { importId: s.importId, risesCount: s.risesCount, kpi: 'A18' } as never,
    })),
  );
}
