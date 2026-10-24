import { parseScaled, roundHalfUp, unitFactorRational } from '../recipes/cost';

/**
 * Inventory count valuation + the actual-food-cost period (flag `inventoryCount`).
 * Pure: no DB, no clock. Money is integer agorot (bigint inside, number out);
 * quantities and prices are NUMERIC(12,4) strings parsed exactly
 * (`parseScaled`), rounded ONCE per line, half-up, to the agora.
 * Units convert through the recipes engine's `unitFactorRational` (which wraps
 * @restomatch/matching's units) — never a second conversion table.
 */

export const STORAGE_AREAS = ['fridge', 'freezer', 'dry', 'produce', 'bar', 'other'] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

/** A paid unit price: ₪ ex-VAT per `unit` (NUMERIC(12,4) string). */
export interface UnitPrice {
  unitPrice: string;
  unit: string | null;
}

export type LineValueStatus = 'ok' | 'notCounted' | 'noPrice' | 'unitMismatch';

export interface LineValue {
  status: LineValueStatus;
  /** ₪ ex-VAT per the LINE's unit (NUMERIC(12,4) string), or null. */
  unitCost: string | null;
  /** qty × unit cost, integer agorot (half-up), or null when not valued. */
  valueAgorot: number | null;
}

const SCALE4 = 10_000n;

function scaled4(n: bigint): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const s = `${a / SCALE4}.${(a % SCALE4).toString().padStart(4, '0')}`;
  return neg ? `-${s}` : s;
}

/**
 * Value one counted line. `qty` in `unit`; `price` per the product's priced
 * unit. A line with no qty is "not counted", one with no price (or a unit that
 * cannot convert to the priced unit) is excluded from the value — shown, not
 * guessed.
 */
export function valueLine(qty: string | null, unit: string, price: UnitPrice | null | undefined): LineValue {
  if (qty == null || qty === '') return { status: 'notCounted', unitCost: null, valueAgorot: null };
  if (!price) return { status: 'noPrice', unitCost: null, valueAgorot: null };
  const f = unitFactorRational(unit, price.unit ?? unit);
  if (!f) return { status: 'unitMismatch', unitCost: null, valueAgorot: null };
  const [num, den] = f;
  const q = parseScaled(qty, 4); // qty × 10^4, in the line unit
  const p = parseScaled(price.unitPrice, 4); // ₪ × 10^4 per priced unit
  // One line unit = num/den priced units ⇒ ₪/line-unit = p × num / den.
  const unitCost = roundHalfUp(p * num, den);
  // value (agorot) = q/10^4 × p/10^4 × num/den × 100 — exact, one rounding.
  const value = roundHalfUp(q * p * num, den * 1_000_000n);
  return { status: 'ok', unitCost: scaled4(unitCost), valueAgorot: Number(value) };
}

export interface CountLineInput {
  productId: string;
  qty: string | null;
  unit: string;
}

export interface CountSummary {
  totalValueAgorot: number;
  lines: number;
  counted: number;
  notCounted: number;
  /** Counted but not valued (no price or an unconvertible unit). */
  unpriced: number;
  values: Map<string, LineValue>;
}

/** Value a whole count against a price map (productId → latest paid price on or before the count date). */
export function valueCount(lines: readonly CountLineInput[], prices: ReadonlyMap<string, UnitPrice>): CountSummary {
  let total = 0n;
  let counted = 0;
  let unpriced = 0;
  const values = new Map<string, LineValue>();
  for (const l of lines) {
    const v = valueLine(l.qty, l.unit, prices.get(l.productId));
    values.set(l.productId, v);
    if (v.status === 'notCounted') continue;
    counted++;
    if (v.status === 'ok') total += BigInt(v.valueAgorot!);
    else unpriced++;
  }
  return { totalValueAgorot: Number(total), lines: lines.length, counted, notCounted: lines.length - counted, unpriced, values };
}

/* ── Actual food cost for a period ─────────────────────────────────────── */

export interface PeriodInput {
  openingAgorot: number;
  /** Purchases in the period, ex-VAT, after duplicates/credits (agorot). */
  purchasesAgorot: number;
  closingAgorot: number;
  /** Food sales ex-VAT for the period (agorot), or null when unknown. */
  salesAgorot: number | null;
  /** Theoretical food cost from recipes × POS quantities (agorot), or null. */
  theoreticalAgorot: number | null;
}

export interface PeriodResult {
  actualAgorot: number;
  /** actual / sales in basis points (half-up), null without sales. */
  actualBp: number | null;
  theoreticalBp: number | null;
  /** actual − theoretical (agorot): "unexplained usage" (waste, portioning, theft). */
  varianceAgorot: number | null;
  varianceBp: number | null;
  /** T2 (act now) only when the unexplained usage is more than 2 points of sales. */
  varianceAlert: boolean;
}

export const VARIANCE_ALERT_BP = 200;

function bpOf(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  const neg = part < 0n;
  const r = roundHalfUp((neg ? -part : part) * 10_000n, whole);
  return Number(neg ? -r : r);
}

export function actualFoodCost(p: PeriodInput): PeriodResult {
  const actual = BigInt(p.openingAgorot) + BigInt(p.purchasesAgorot) - BigInt(p.closingAgorot);
  const sales = p.salesAgorot == null ? null : BigInt(p.salesAgorot);
  const theo = p.theoreticalAgorot == null ? null : BigInt(p.theoreticalAgorot);
  const variance = theo == null ? null : actual - theo;
  const varianceBp = variance == null || sales == null ? null : bpOf(variance, sales);
  return {
    actualAgorot: Number(actual),
    actualBp: sales == null ? null : bpOf(actual, sales),
    theoreticalBp: theo == null || sales == null ? null : bpOf(theo, sales),
    varianceAgorot: variance == null ? null : Number(variance),
    varianceBp,
    varianceAlert: varianceBp != null && varianceBp > VARIANCE_ALERT_BP,
  };
}
