import {
  and,
  desc,
  eq,
  gte,
  inArray,
  invoiceLines,
  invoices,
  isNotNull,
  products,
  restaurants,
  supplierContractPrices,
  suppliers,
  type Database,
} from '@restomatch/db';
import { resolveTolerances } from '@restomatch/matching';
import { contractInForce, contractPriceInUnit, indexContracts, isOverContract, localDateKey } from './core';

const DEFAULT_TZ = 'Asia/Jerusalem';

export interface OverContractLine {
  invoiceLineId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: Date;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  productNameEn: string | null;
  unit: string;
  qty: number;
  billedUnitPrice: number;
  contractUnitPrice: number;
  contractId: string;
  /** (billed − contract) × qty, integer agorot (always > 0). */
  overAgorot: number;
}

/**
 * Every invoice line billed above the contract price in force on its invoice's
 * local date (rule 5 in core.ts) — the source of the "over contract" badge on
 * the invoice and leak views. Read-only; restaurant-scoped. Covers lines with
 * and without a PO (the leak itself is counted by the engine — this never adds
 * to the leak figure).
 */
export async function findOverContractLines(
  db: Database,
  restaurantId: string,
  filter: { invoiceIds?: string[]; since?: Date; limit?: number } = {},
): Promise<OverContractLine[]> {
  const [restaurant] = await db
    .select({ settings: restaurants.settings, timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!restaurant) return [];
  const tz = restaurant.timezone ?? DEFAULT_TZ;
  const tolerances = resolveTolerances(restaurant.settings?.tolerances);

  if (filter.invoiceIds && filter.invoiceIds.length === 0) return [];
  const conds = [
    eq(invoices.restaurantId, restaurantId),
    isNotNull(invoices.supplierId),
    isNotNull(invoiceLines.productId),
  ];
  if (filter.invoiceIds) conds.push(inArray(invoices.id, filter.invoiceIds));
  if (filter.since) conds.push(gte(invoices.createdAt, filter.since));

  const lines = await db
    .select({
      invoiceLineId: invoiceLines.id,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      createdAt: invoices.createdAt,
      supplierId: invoices.supplierId,
      supplierName: suppliers.name,
      productId: invoiceLines.productId,
      productName: products.canonicalName,
      productNameEn: products.nameEn,
      unit: invoiceLines.unit,
      qty: invoiceLines.qtyBilled,
      billed: invoiceLines.unitPriceBilled,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .innerJoin(products, eq(products.id, invoiceLines.productId))
    .where(and(...conds))
    .orderBy(desc(invoices.createdAt))
    .limit(5000);
  if (lines.length === 0) return [];

  const supplierIds = [...new Set(lines.map((l) => l.supplierId!))];
  const contracts = await db
    .select({
      id: supplierContractPrices.id,
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      unit: supplierContractPrices.unit,
      contractPrice: supplierContractPrices.contractPrice,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .where(
      and(
        eq(supplierContractPrices.restaurantId, restaurantId),
        inArray(supplierContractPrices.supplierId, supplierIds),
      ),
    );
  if (contracts.length === 0) return [];
  const byKey = indexContracts(contracts);

  const out: OverContractLine[] = [];
  for (const l of lines) {
    const list = byKey.get(`${l.supplierId}:${l.productId}`);
    if (!list) continue;
    const date = l.invoiceDate ?? l.createdAt;
    const contract = contractInForce(list, localDateKey(date, tz));
    if (!contract) continue;
    const contractPrice = contractPriceInUnit(contract, l.unit);
    if (contractPrice === null) continue;
    const billed = Number(l.billed);
    if (!isOverContract(billed, contractPrice, tolerances)) continue;
    const qty = Number(l.qty);
    // (billed − contract) × qty in agorot, half-up from the 4-dp price units.
    const overAgorot = Math.round(((Math.round(billed * 10_000) - Math.round(contractPrice * 10_000)) * qty) / 100);
    out.push({
      invoiceLineId: l.invoiceLineId,
      invoiceId: l.invoiceId,
      invoiceNumber: l.invoiceNumber,
      invoiceDate: date,
      supplierId: l.supplierId!,
      supplierName: l.supplierName,
      productId: l.productId!,
      productName: l.productName,
      productNameEn: l.productNameEn,
      unit: l.unit,
      qty,
      billedUnitPrice: billed,
      contractUnitPrice: contractPrice,
      contractId: contract.id,
      overAgorot: Math.max(overAgorot, 0),
    });
    if (filter.limit && out.length >= filter.limit) break;
  }
  return out;
}
