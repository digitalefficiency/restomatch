import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  products,
  sql,
  supplierContractPrices,
  type Database,
} from '@restomatch/db';
import type { PoLineInput } from '@restomatch/matching';
import { contractInForce, contractPriceInUnit, indexContracts, type ContractRow } from './core';

/**
 * Contract rows covering `day` for one supplier and a set of products. Scoped by
 * restaurant_id explicitly (runs on the worker's service connection too).
 */
export async function loadContractsInForce(
  db: Database,
  restaurantId: string,
  supplierId: string,
  productIds: string[],
  day: string,
): Promise<ContractRow[]> {
  if (productIds.length === 0) return [];
  return db
    .select({
      id: supplierContractPrices.id,
      supplierId: supplierContractPrices.supplierId,
      productId: supplierContractPrices.productId,
      // A contract without its own unit is quoted in the product's default unit.
      unit: sql<string | null>`coalesce(${supplierContractPrices.unit}, ${products.defaultUnit})`,
      contractPrice: supplierContractPrices.contractPrice,
      validFrom: supplierContractPrices.validFrom,
      validTo: supplierContractPrices.validTo,
    })
    .from(supplierContractPrices)
    .innerJoin(products, eq(products.id, supplierContractPrices.productId))
    .where(
      and(
        eq(supplierContractPrices.restaurantId, restaurantId),
        eq(supplierContractPrices.supplierId, supplierId),
        inArray(supplierContractPrices.productId, productIds),
        lte(supplierContractPrices.validFrom, day),
        or(isNull(supplierContractPrices.validTo), gte(supplierContractPrices.validTo, day)),
      ),
    );
}

/**
 * Rule 3 (contracts/core.ts): replace each PO line's expected unit price with
 * the contract price in force on the invoice day, converted to the PO line's
 * unit. Lines without a product, without a contract or with an unconvertible
 * unit keep their PO price. Returns new objects; the input is not mutated.
 */
export async function applyContractPrices(
  db: Database,
  restaurantId: string,
  supplierId: string,
  poLines: PoLineInput[],
  day: string,
): Promise<{ poLines: PoLineInput[]; applied: number }> {
  const productIds = [...new Set(poLines.map((l) => l.productId).filter((p): p is string => !!p))];
  const rows = await loadContractsInForce(db, restaurantId, supplierId, productIds, day);
  if (rows.length === 0) return { poLines, applied: 0 };
  const byKey = indexContracts(rows);
  let applied = 0;
  const out = poLines.map((l) => {
    if (!l.productId) return l;
    const contract = contractInForce(byKey.get(`${supplierId}:${l.productId}`) ?? [], day);
    if (!contract) return l;
    const price = contractPriceInUnit(contract, l.unit);
    if (price === null) return l;
    // Rule 3: the contract is a CEILING — a PO priced at or below it stands, so a
    // supplier billing the (lower) PO price never shows a false PRICE_LOWER.
    if (l.unitPriceExpected !== null && l.unitPriceExpected <= price) return l;
    applied += 1;
    return { ...l, unitPriceExpected: price };
  });
  return { poLines: out, applied };
}
