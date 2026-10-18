import { unitConversionFactor } from '@restomatch/matching';

/**
 * Food cost per dish — the pure cost engine (wave 1, flag `recipes`).
 *
 * MONEY RULE (integer agorot, documented rounding):
 *   - DB NUMERIC strings are parsed at the boundary into scaled BigInts — no
 *     float ever touches money: quantities and unit prices are scale-4
 *     (1 ₪ = 10 000 price units, i.e. 1 price unit = 1/100 agora), waste is
 *     basis points (5.25% = 525), VAT is basis points (0.18 = 1800).
 *   - Each recipe LINE is computed as an EXACT rational number of agorot
 *       qty × unitFactor × unitPrice × 100 × 10000 / (10000 − wasteBp)
 *     and rounded HALF-UP to whole agorot exactly ONCE (x.5 agora → up).
 *   - A recipe's batch cost is the SUM of its rounded lines (integer agorot).
 *   - A sub-recipe line costs batchCost × usedQty / yieldQty (exact rational,
 *     rounded half-up once) — the sub-recipe's per-gram cost is never rounded
 *     on its own, so a 30 g spoon of a 2 kg sauce is not distorted.
 *   - Per-portion cost = batchCost / yieldQty, half-up. Net menu price =
 *     menuPrice × 10000 / (10000 + vatBp), half-up, when the price includes
 *     VAT. Food-cost % is basis points (half-up); margin = net − cost (exact).
 *   - Unit prices come from price_history, which stores them ex-VAT per the
 *     product's default unit (see match/priceHistory.ts), so cost and the net
 *     menu price are compared like for like.
 */

/* ── Scaled decimal parsing (boundary) ─────────────────────────────────── */

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parse a decimal string ("12.3456") into a BigInt scaled by 10^scale, half-up beyond `scale`. */
export function parseScaled(value: string | number, scale: number): bigint {
  const s = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${JSON.stringify(value)}`);
  const [, neg, int, frac = ''] = m;
  const head = frac.slice(0, scale).padEnd(scale, '0');
  let n = BigInt(int! + head);
  const next = frac.charCodeAt(scale);
  if (frac.length > scale && next >= 53 /* '5' */) n += 1n;
  return neg ? -n : n;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not finite: ${n}`);
  // toFixed(10) avoids exponent notation for the magnitudes we accept.
  return n.toFixed(10);
}

/** Round a non-negative rational N/D (D > 0) half-up to an integer. */
export function roundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('denominator must be positive');
  if (n < 0n) return -roundHalfUp(-n, d);
  return (2n * n + d) / (2n * d);
}

/* ── Units ─────────────────────────────────────────────────────────────── */

function normUnit(u: string): string {
  return u.trim().toLowerCase().replace(/["'.\s׳״]/g, '');
}

/** Count units that units.ts does not model (it covers mass + volume only). */
const COUNT_UNITS = new Set(['יח', 'יחידה', 'יחידות', 'unit', 'units', 'pc', 'pcs', 'ea', 'each']);
const PORTION_UNITS = new Set(['מנה', 'מנות', 'portion', 'portions', 'serving', 'servings']);

function sameUnit(a: string, b: string): boolean {
  const x = normUnit(a);
  const y = normUnit(b);
  if (x === y) return true;
  if (COUNT_UNITS.has(x) && COUNT_UNITS.has(y)) return true;
  return PORTION_UNITS.has(x) && PORTION_UNITS.has(y);
}

/** Exact rational [num, den] such that qty_to = qty_from × num / den, or null. */
export function unitFactorRational(from: string, to: string): [bigint, bigint] | null {
  if (sameUnit(from, to)) return [1n, 1n];
  const f = unitConversionFactor(from, to);
  if (f === null) return null;
  // units.ts factors are powers of ten between 1e-6 and 1e6 — exact at 1e6.
  return [BigInt(Math.round(f * 1e6)), 1_000_000n];
}

/** True when `from` can be costed against `to` without a manual bridge. */
export function unitsCompatible(from: string, to: string): boolean {
  return unitFactorRational(from, to) !== null;
}

/* ── Inputs ────────────────────────────────────────────────────────────── */

export interface CostItem {
  id: string;
  productId: string | null;
  subRecipeId: string | null;
  /** NUMERIC(12,4) string — net quantity in `unit`. */
  quantity: string;
  unit: string;
  /** NUMERIC(5,2) string, 0 ≤ waste < 100. */
  wastePct: string;
  /** NUMERIC(12,4) string or null — how many `unit` in one product (or yield) unit. */
  unitsPerProductUnit: string | null;
}

export interface CostRecipe {
  id: string;
  name: string;
  isSubRecipe: boolean;
  yieldQty: string;
  yieldUnit: string;
  menuPriceAgorot: number | null;
  menuPriceIncludesVat: boolean;
  items: CostItem[];
}

export interface ProductPrice {
  /** NUMERIC(12,4) shekels per `unit` (ex-VAT, price_history). */
  unitPrice: string;
  /** The unit the price is per (the product's default unit); null = same as the line. */
  unit: string | null;
}

export type PriceMap = ReadonlyMap<string, ProductPrice>;

/* ── Outputs ───────────────────────────────────────────────────────────── */

export type LineStatus = 'ok' | 'missingPrice' | 'unitMismatch' | 'missingSubRecipe' | 'cycle' | 'overflow';

export interface LineCost {
  itemId: string;
  productId: string | null;
  subRecipeId: string | null;
  status: LineStatus;
  /** Integer agorot for this line (0 when status ≠ ok). */
  costAgorot: number;
}

export interface RecipeCost {
  recipeId: string;
  /** Sum of the rounded lines (integer agorot) for one batch. */
  batchCostAgorot: number;
  /** batch / yield, half-up. */
  portionCostAgorot: number;
  /** Menu price net of VAT (agorot), or null when no menu price. */
  netMenuPriceAgorot: number | null;
  /** Food cost in basis points of the net menu price (3125 = 31.25%), or null. */
  foodCostBp: number | null;
  /** net menu price − portion cost (agorot), or null. */
  grossMarginAgorot: number | null;
  /** Every line priced (no missing price / unit mismatch / broken sub-recipe). */
  complete: boolean;
  lines: LineCost[];
}

export class RecipeCycleError extends Error {
  constructor(readonly path: string[]) {
    super(`recipe cycle: ${path.join(' → ')}`);
    this.name = 'RecipeCycleError';
  }
}

const BP = 10_000n;

/** ₪1bn in agorot — any single amount beyond this is nonsense input, not a dish. */
export const MAX_AMOUNT_AGOROT = 100_000_000_000n;

export class AmountOverflowError extends RangeError {
  constructor() {
    super('amount exceeds the supported range');
    this.name = 'AmountOverflowError';
  }
}

function toSafeNumber(n: bigint): number {
  if (n > MAX_AMOUNT_AGOROT || n < -MAX_AMOUNT_AGOROT) throw new AmountOverflowError();
  return Number(n);
}

/** VAT rate NUMERIC(5,4) ("0.1800") → basis points (1800). */
export function vatRateToBp(vatRate: string | number): bigint {
  return parseScaled(vatRate, 4);
}

/** Net-of-VAT menu price in agorot (half-up), or the price itself when it excludes VAT. */
export function netMenuPrice(menuPriceAgorot: number, includesVat: boolean, vatBp: bigint): number {
  if (!includesVat) return menuPriceAgorot;
  return toSafeNumber(roundHalfUp(BigInt(menuPriceAgorot) * BP, BP + vatBp));
}

/**
 * Cost every recipe against `prices`. Sub-recipes are resolved recursively
 * (memoised); a cycle marks the offending lines `cycle` instead of throwing so
 * one bad edit cannot blank the whole list (the save path rejects cycles).
 */
export function costRecipes(
  recipes: readonly CostRecipe[],
  prices: PriceMap,
  vatBp: bigint,
): Map<string, RecipeCost> {
  const byId = new Map(recipes.map((r) => [r.id, r] as const));
  const done = new Map<string, RecipeCost>();
  const visiting = new Set<string>();

  /**
   * An absurd batch (e.g. 99 999 999 portions of a 0.0001-yield sub-recipe)
   * marks THAT recipe's lines `overflow` instead of throwing, so one bad row
   * can never blank every recipes screen (the save path rejects it too).
   */
  const costOf = (r: CostRecipe): RecipeCost => {
    const memo = done.get(r.id);
    if (memo) return memo;
    try {
      return costOfUnsafe(r);
    } catch (err) {
      if (!(err instanceof AmountOverflowError)) throw err;
      visiting.delete(r.id);
      const result: RecipeCost = {
        recipeId: r.id,
        batchCostAgorot: 0,
        portionCostAgorot: 0,
        netMenuPriceAgorot: null,
        foodCostBp: null,
        grossMarginAgorot: null,
        complete: false,
        lines: r.items.map((it) => ({ itemId: it.id, productId: it.productId, subRecipeId: it.subRecipeId, status: 'overflow', costAgorot: 0 })),
      };
      done.set(r.id, result);
      return result;
    }
  };

  const costOfUnsafe = (r: CostRecipe): RecipeCost => {
    visiting.add(r.id);
    const yieldScaled = parseScaled(r.yieldQty, 4);
    const lines: LineCost[] = [];
    let batch = 0n;
    for (const it of r.items) {
      const line = costLine(it, r.id);
      lines.push({ ...line, costAgorot: toSafeNumber(line.cost) });
      batch += line.cost;
    }
    visiting.delete(r.id);
    const portion = yieldScaled > 0n ? roundHalfUp(batch * BP, yieldScaled) : batch;
    let net: number | null = null;
    let foodCostBp: number | null = null;
    let margin: number | null = null;
    if (r.menuPriceAgorot != null) {
      net = netMenuPrice(r.menuPriceAgorot, r.menuPriceIncludesVat, vatBp);
      margin = net - toSafeNumber(portion);
      foodCostBp = net > 0 ? toSafeNumber(roundHalfUp(portion * BP, BigInt(net))) : null;
    }
    const result: RecipeCost = {
      recipeId: r.id,
      batchCostAgorot: toSafeNumber(batch),
      portionCostAgorot: toSafeNumber(portion),
      netMenuPriceAgorot: net,
      foodCostBp,
      grossMarginAgorot: margin,
      complete: lines.every((l) => l.status === 'ok'),
      lines,
    };
    done.set(r.id, result);
    return result;
  };

  const costLine = (it: CostItem, ownerId: string): Omit<LineCost, 'costAgorot'> & { cost: bigint } => {
    const base = { itemId: it.id, productId: it.productId, subRecipeId: it.subRecipeId };
    const q = parseScaled(it.quantity, 4);
    const wasteBp = parseScaled(it.wastePct, 2);
    if (wasteBp < 0n || wasteBp >= BP) throw new RangeError(`waste out of range: ${it.wastePct}`);
    const keep = BP - wasteBp;

    if (it.subRecipeId) {
      const sub = byId.get(it.subRecipeId);
      if (!sub) return { ...base, status: 'missingSubRecipe', cost: 0n };
      if (visiting.has(sub.id) || sub.id === ownerId) return { ...base, status: 'cycle', cost: 0n };
      const subCost = costOf(sub);
      const conv = bridge(it, sub.yieldUnit);
      if (!conv) return { ...base, status: 'unitMismatch', cost: 0n };
      const y = parseScaled(sub.yieldQty, 4);
      const [cn, cd] = conv;
      // batch × (q / 10^4 × cn / cd) / (y / 10^4) × 10^4 / keep
      const n = BigInt(subCost.batchCostAgorot) * q * cn * BP;
      const d = y * cd * keep;
      const status: LineStatus = subCost.complete ? 'ok' : (subCost.lines.find((l) => l.status !== 'ok')?.status ?? 'ok');
      return { ...base, status, cost: roundHalfUp(n, d) };
    }

    const price = it.productId ? prices.get(it.productId) : undefined;
    if (!price) return { ...base, status: 'missingPrice', cost: 0n };
    const conv = bridge(it, price.unit ?? it.unit);
    if (!conv) return { ...base, status: 'unitMismatch', cost: 0n };
    const p = parseScaled(price.unitPrice, 4);
    const [cn, cd] = conv;
    // (q / 10^4) × (cn / cd) × (p / 10^4 ₪) × 100 agorot/₪ × 10^4 / keep
    const n = q * cn * p * 100n * BP;
    const d = BP * cd * BP * keep;
    return { ...base, status: 'ok', cost: roundHalfUp(n, d) };
  };

  /** Factor from the line's unit into `target`, via units.ts or the manual bridge. */
  const bridge = (it: CostItem, target: string): [bigint, bigint] | null => {
    const direct = unitFactorRational(it.unit, target);
    if (direct) return direct;
    if (it.unitsPerProductUnit) {
      const u = parseScaled(it.unitsPerProductUnit, 4);
      if (u > 0n) return [BP, u]; // qty_target = qty / unitsPer
    }
    return null;
  };

  for (const r of recipes) costOf(r);
  return done;
}

/**
 * Throws RecipeCycleError when saving `recipeId` with `subRecipeIds` would
 * create a cycle, given the current sub-recipe edges of the restaurant.
 */
export function assertNoCycle(
  recipeId: string,
  subRecipeIds: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): void {
  const graph = new Map(edges);
  graph.set(recipeId, subRecipeIds);
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (onStack.has(id)) throw new RecipeCycleError([...stack.slice(stack.indexOf(id)), id]);
    if (seen.has(id)) return;
    seen.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of graph.get(id) ?? []) visit(next);
    stack.pop();
    onStack.delete(id);
  };
  visit(recipeId);
}

/* ── Price-change impact ("chicken +12% → schnitzel 31% → 34%") ───────── */

/** Scale a NUMERIC(12,4) price by (1 + changeBp/10000), half-up at scale 4. */
export function applyPriceChange(unitPrice: string, changeBp: number): string {
  const p = parseScaled(unitPrice, 4);
  const next = roundHalfUp(p * (BP + BigInt(changeBp)), BP);
  if (next < 0n) throw new RangeError('price change makes the price negative');
  return formatScaled(next, 4);
}

/** Scaled BigInt → plain decimal string ("12.3400"). */
export function formatScaled(n: bigint, scale: number): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const out = `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
  return neg ? `-${out}` : out;
}

export interface ImpactRow {
  recipeId: string;
  before: RecipeCost;
  after: RecipeCost;
  /** after.portion − before.portion (agorot). */
  portionCostDeltaAgorot: number;
  /** after.margin − before.margin (agorot), null without a menu price. */
  marginDeltaAgorot: number | null;
}

/** Every recipe whose cost changes when `productId`'s price moves by `changeBp`. */
export function simulatePriceChange(
  recipes: readonly CostRecipe[],
  prices: PriceMap,
  vatBp: bigint,
  productId: string,
  changeBp: number,
): ImpactRow[] {
  const cur = prices.get(productId);
  if (!cur) return [];
  const next = new Map(prices);
  next.set(productId, { ...cur, unitPrice: applyPriceChange(cur.unitPrice, changeBp) });
  return diffCosts(recipes, costRecipes(recipes, prices, vatBp), costRecipes(recipes, next, vatBp));
}

export function diffCosts(
  recipes: readonly CostRecipe[],
  before: ReadonlyMap<string, RecipeCost>,
  after: ReadonlyMap<string, RecipeCost>,
): ImpactRow[] {
  const rows: ImpactRow[] = [];
  for (const r of recipes) {
    const b = before.get(r.id);
    const a = after.get(r.id);
    if (!a || !b) continue;
    const delta = a.portionCostAgorot - b.portionCostAgorot;
    if (delta === 0) continue;
    rows.push({
      recipeId: r.id,
      before: b,
      after: a,
      portionCostDeltaAgorot: delta,
      marginDeltaAgorot:
        a.grossMarginAgorot != null && b.grossMarginAgorot != null ? a.grossMarginAgorot - b.grossMarginAgorot : null,
    });
  }
  return rows.sort((x, y) => Math.abs(y.portionCostDeltaAgorot) - Math.abs(x.portionCostDeltaAgorot));
}

/* ── Traffic light against the restaurant's target ─────────────────────── */

export type CostLight = 'green' | 'amber' | 'red' | 'none';

/** Default food-cost target (30%) and the amber band above it (3 points). */
export const DEFAULT_TARGET_BP = 3000;
export const AMBER_BAND_BP = 300;

export function costLight(foodCostBp: number | null, targetBp: number): CostLight {
  if (foodCostBp == null) return 'none';
  if (foodCostBp <= targetBp) return 'green';
  if (foodCostBp <= targetBp + AMBER_BAND_BP) return 'amber';
  return 'red';
}
