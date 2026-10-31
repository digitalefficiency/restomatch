import { unitConversionFactor } from '@restomatch/matching';

export interface CatalogPriceInput {
  listPrice: string | null;
  unit: string | null;
  packSize: string | null;
  /** The product's default unit — the unit price_history is normalized to. */
  productUnit: string | null;
}

const normUnit = (u: string) => u.trim().toLowerCase().replace(/["'.\s׳״]/g, '');

/**
 * A catalog list price expressed per the product's default unit, or null when
 * it can't be compared safely: a pack price (pack_size > 1), or a unit that
 * doesn't convert. The one definition shared by the price-alert sweep (cheaper
 * offers) and the product page ("הזול ביותר"), so they can never disagree.
 */
export function catalogUnitPrice(c: CatalogPriceInput): number | null {
  const price = Number(c.listPrice);
  if (c.listPrice == null || !Number.isFinite(price) || price <= 0) return null;
  if (c.packSize != null && Number(c.packSize) !== 1) return null;
  // No unit on either side = quoted in the product's own unit.
  if (!c.unit || !c.productUnit) return price;
  if (normUnit(c.unit) === normUnit(c.productUnit)) return price;
  const f = unitConversionFactor(c.unit, c.productUnit);
  return f ? Math.round((price / f) * 10_000) / 10_000 : null;
}

/** Same unit after normalisation (״/׳, case, dots, spaces). */
export function sameUnit(a: string | null, b: string | null): boolean {
  return a != null && b != null && normUnit(a) === normUnit(b);
}

/**
 * The cheapest comparable price, or null when fewer than two prices are
 * comparable (one price is not a comparison, and a pack price next to a kilo
 * price is not either).
 */
export function cheapestComparable(prices: Array<number | null>): number | null {
  const ok = prices.filter((p): p is number => p != null);
  return ok.length >= 2 ? Math.min(...ok) : null;
}
