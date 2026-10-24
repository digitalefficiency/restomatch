import { eq, restaurants, type Database } from '@restomatch/db';
import { contractInForce, contractPriceInUnit, indexContracts, localDateKey } from './core';
import { loadContractsInForce } from './load';

const DEFAULT_TZ = 'Asia/Jerusalem';

/** `${productId}|${unit}` — the key of {@link contractPricesForOrder}'s map. */
export const orderPriceKey = (productId: string, unit: string) => `${productId}|${unit}`;

/**
 * Contract unit price in force on `at` (the restaurant's local day) for each
 * (product, unit) of one supplier, converted to that unit. Lines without a
 * contract, with an unconvertible unit or with a ≤ 0 contract are absent.
 * Read-only; callers gate on the `contracts` flag.
 */
export async function contractPricesForOrder(
  db: Database,
  restaurantId: string,
  supplierId: string,
  items: ReadonlyArray<{ productId: string; unit: string }>,
  at: Date = new Date(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (productIds.length === 0) return out;
  const [r] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const day = localDateKey(at, r?.timezone ?? DEFAULT_TZ);
  const rows = await loadContractsInForce(db, restaurantId, supplierId, productIds, day);
  if (rows.length === 0) return out;
  const byKey = indexContracts(rows);
  for (const it of items) {
    const contract = contractInForce(byKey.get(`${supplierId}:${it.productId}`) ?? [], day);
    if (!contract) continue;
    const price = contractPriceInUnit(contract, it.unit);
    if (price !== null && price > 0) out.set(orderPriceKey(it.productId, it.unit), price);
  }
  return out;
}

/** The PO price IS the contract price (to the agora) — only then may it be called "agreed". */
export function isContractPrice(poUnitPrice: number | null, contractPrice: number | undefined): boolean {
  if (poUnitPrice === null || contractPrice === undefined) return false;
  return Math.round(poUnitPrice * 100) === Math.round(contractPrice * 100);
}
