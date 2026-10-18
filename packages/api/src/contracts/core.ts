import type { Tolerances } from '@restomatch/types';
import { unitConversionFactor } from '@restomatch/matching';

/**
 * Supplier contract prices (wave-1 `contracts`) — pure rules, no DB.
 *
 * THE RULE (documented in docs/client-ready/reports/wave1-contracts.md):
 *  1. A contract row covers a product from one supplier on [validFrom, validTo]
 *     (restaurant-local calendar dates, inclusive; validTo null = open-ended).
 *  2. The contract IN FORCE on the invoice's local date is the covering row with
 *     the LATEST validFrom (a renegotiated price supersedes the old one).
 *  3. Contract beats PO as a CEILING: when both exist and the PO price is above
 *     the contract (or missing), the contract price is the expected unit price
 *     fed to the engine (buildMatchInput), so an over-contract line is a
 *     PRICE_HIGHER whose expected value is the contract price. A PO priced at or
 *     below the contract stands (billing the lower PO price must never turn into
 *     a PRICE_LOWER "leak"). The engine's own tolerances apply — no engine change.
 *  4. Units: a contract without its own unit is quoted in the product's default
 *     unit (resolved by the loaders). The price is converted to the line's unit
 *     with the engine's kg↔g / l↔ml table; an unknown or unconvertible unit means
 *     the contract does not apply to that line (never guess).
 *  5. "Over contract" (the UI badge) = billed unit price above the contract
 *     price by more than the restaurant's price tolerance — exactly when the
 *     engine would emit PRICE_HIGHER against it.
 */

export interface ContractRow {
  id: string;
  supplierId: string;
  productId: string;
  unit: string | null;
  /** Shekels, NUMERIC(12,4) string or number. */
  contractPrice: string | number;
  validFrom: string; // YYYY-MM-DD
  validTo: string | null;
}

/** Restaurant-local calendar date (YYYY-MM-DD) of an instant. */
export function localDateKey(instant: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The contract row in force on `day` (YYYY-MM-DD), or null. Rule 1 + 2. */
export function contractInForce<T extends ContractRow>(rows: T[], day: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.validFrom > day) continue;
    if (r.validTo != null && r.validTo < day) continue;
    if (!best || r.validFrom > best.validFrom) best = r;
  }
  return best;
}

/**
 * Contract unit price expressed in `lineUnit` (rule 4). Returns null when the
 * units cannot be converted. Rounded to the 4-decimal NUMERIC price scale.
 */
export function contractPriceInUnit(contract: ContractRow, lineUnit: string): number | null {
  const price = Number(contract.contractPrice);
  if (!Number.isFinite(price)) return null;
  if (!contract.unit) return null; // no unit anywhere → can't compare safely
  if (sameUnit(contract.unit, lineUnit)) return price;
  // qty_line = qty_contract × factor ⇒ price_line = price_contract / factor.
  const factor = unitConversionFactor(contract.unit, lineUnit);
  if (factor === null || factor === 0) return null;
  return Math.round((price / factor) * 10_000) / 10_000;
}

function sameUnit(a: string, b: string): boolean {
  const n = (u: string) => u.trim().toLowerCase().replace(/["'.\s׳״]/g, '');
  return n(a) === n(b);
}

/**
 * Rule 5 — true when `billed` is above `contract` beyond the price tolerance
 * (the engine's evaluatePrice "clean" band: within BOTH pricePercent and
 * priceAbsolute is clean). Compared in integer price units (1/10000 ₪).
 */
export function isOverContract(
  billed: number,
  contract: number,
  tolerances: Pick<Required<Tolerances>, 'pricePercent' | 'priceAbsolute'>,
): boolean {
  const b = Math.round(billed * 10_000);
  const c = Math.round(contract * 10_000);
  if (b <= c) return false;
  const diff = (b - c) / 10_000;
  const pct = c > 0 ? (b - c) / c : 1;
  return !(pct <= tolerances.pricePercent && diff <= tolerances.priceAbsolute);
}

/** Group contract rows by `${supplierId}:${productId}`. */
export function indexContracts<T extends ContractRow>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = `${r.supplierId}:${r.productId}`;
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  }
  return map;
}
