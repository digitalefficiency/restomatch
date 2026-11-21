import {
  and,
  auditLog,
  eq,
  gte,
  inArray,
  lte,
  suppliers,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import type { ContractEndingGroup } from './digest';

/**
 * AU-13 AC 2 — contract prices ending within 14 days. The ONE reader of
 * `supplier_contract_prices` in `priceAlerts/**` (read only; W2-12 owns the
 * contracts read side).
 *
 * `valid_to` is a restaurant-local calendar date, inclusive (`contracts/core.ts`
 * rule 1). Everything here compares YYYY-MM-DD STRINGS taken from the Israel day,
 * never a UTC `Date`.
 *
 * A row is "ending" when valid_to ∈ [today, today + 14] and nothing renews it:
 * no other row for the same (supplier, product) starts after valid_to, and none
 * covers the day after it. Grouped by (supplier, valid_to). Each group is
 * announced ONCE: the audit row `prices.contract_expiry_notified` is the "once".
 */
export const CONTRACT_EXPIRY_HORIZON_DAYS = 14;
export const CONTRACT_EXPIRY_AUDIT = 'prices.contract_expiry_notified';

/** "2026-11-30" + 1 → "2026-12-01" (calendar arithmetic on the date string). */
export function addDays(ymd: string, days: number): string {
  const t = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface ContractExpiryRow {
  supplierId: string;
  productId: string;
  validFrom: string;
  validTo: string | null;
}

export const contractGroupKey = (g: { supplierId: string; validTo: string }) => `${g.supplierId}:${g.validTo}`;

/** Pure: the (supplier, valid_to) groups ending in [today, today + horizon], renewals excluded. */
export function endingContractGroups(
  rows: readonly ContractExpiryRow[],
  today: string,
  horizonDays = CONTRACT_EXPIRY_HORIZON_DAYS,
): Array<{ supplierId: string; validTo: string; productIds: string[] }> {
  const last = addDays(today, horizonDays);
  const groups = new Map<string, { supplierId: string; validTo: string; productIds: Set<string> }>();
  for (const r of rows) {
    const end = r.validTo;
    if (end == null || end < today || end > last) continue;
    const next = addDays(end, 1);
    const renewed = rows.some(
      (o) =>
        o !== r &&
        o.supplierId === r.supplierId &&
        o.productId === r.productId &&
        (o.validFrom > end || (o.validFrom <= next && (o.validTo == null || o.validTo >= next))),
    );
    if (renewed) continue;
    const k = contractGroupKey({ supplierId: r.supplierId, validTo: end });
    const g = groups.get(k) ?? { supplierId: r.supplierId, validTo: end, productIds: new Set<string>() };
    g.productIds.add(r.productId);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ supplierId: g.supplierId, validTo: g.validTo, productIds: [...g.productIds] }));
}

/** Groups ending soon that were not announced yet, with supplier names. Restaurant-scoped. */
export async function contractsEnding(db: Database, restaurantId: string, today: string): Promise<ContractEndingGroup[]> {
  const last = addDays(today, CONTRACT_EXPIRY_HORIZON_DAYS);
  const ending = await db
    .select({ supplierId: supplierContractPrices.supplierId, productId: supplierContractPrices.productId })
    .from(supplierContractPrices)
    .where(
      and(
        eq(supplierContractPrices.restaurantId, restaurantId),
        gte(supplierContractPrices.validTo, today),
        lte(supplierContractPrices.validTo, last),
      ),
    );
  if (ending.length === 0) return [];
  // Every row of the affected (supplier, product) pairs, to see renewals.
  const rows = await db
    .select({
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .where(
      and(
        eq(supplierContractPrices.restaurantId, restaurantId),
        inArray(supplierContractPrices.productId, [...new Set(ending.map((e) => e.productId))]),
      ),
    );
  const groups = endingContractGroups(rows, today);
  if (groups.length === 0) return [];

  const announced = new Set(
    (
      await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, CONTRACT_EXPIRY_AUDIT)))
    ).map((r) => (r.after as { key?: string } | null)?.key ?? ''),
  );
  const fresh = groups.filter((g) => !announced.has(contractGroupKey(g)));
  if (fresh.length === 0) return [];

  const names = new Map(
    (
      await db
        .select({ id: suppliers.id, name: suppliers.name })
        .from(suppliers)
        .where(and(eq(suppliers.restaurantId, restaurantId), inArray(suppliers.id, [...new Set(fresh.map((g) => g.supplierId))])))
    ).map((s) => [s.id, s.name]),
  );
  return fresh
    .filter((g) => names.has(g.supplierId))
    .map((g) => ({ supplierId: g.supplierId, supplierName: names.get(g.supplierId)!, validTo: g.validTo, productCount: g.productIds.length }));
}

/** Record the "once" for each announced group (after the mail is queued). */
export async function markContractsAnnounced(db: Database, restaurantId: string, groups: readonly ContractEndingGroup[]): Promise<void> {
  if (groups.length === 0) return;
  await db.insert(auditLog).values(
    groups.map((g) => ({
      restaurantId,
      userId: null,
      action: CONTRACT_EXPIRY_AUDIT,
      entityType: 'supplier',
      entityId: g.supplierId,
      after: { key: contractGroupKey(g), validTo: g.validTo, productCount: g.productCount, kpi: 'A18' } as never,
    })),
  );
}
