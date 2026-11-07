/**
 * W3-02 slice b · the food-cost control room, as PURE functions (no DB).
 *
 * Inputs are local structural types shaped like W2-07's `inventory.period`
 * output (opening / closing count ends, purchases, credits, sales). Nothing
 * here is imported from W2-07's unmerged code; the router wires the real
 * period in once #253 is on main. All money is integer agorot, and all ratios
 * are basis points with half-up rounding (roundHalfUp from the cost engine).
 *
 *  - equation()       opening + purchases − credits − closing = usage, and
 *                     usage ÷ sales. Each term carries a drill target, so the
 *                     UI makes every number clickable (purchases → invoices,
 *                     credits → credit requests, stock → the count).
 *  - periodSeries()   the sparkline: one point per closed period, a gap where
 *                     a period has no honest %, plus the target line.
 *  - categorySplit()  usage per category, with shares that sum to exactly 100%.
 *  - topUnexplained() the 10 products whose actual usage most exceeds what
 *                     the recipes explain (the "where did it go?" list).
 */
import { roundHalfUp } from '../recipes/cost';
import { sharesBp } from '../recipes/preview';

/* ── Drill targets (the UI maps them to links) ─────────────────────────── */

export type Drill =
  | { kind: 'count'; countId: string }
  | { kind: 'invoices'; from: string; to: string }
  | { kind: 'credits'; from: string; to: string }
  | { kind: 'sales'; countId: string; source: 'pos' | 'manual' | null };

/* ── 1. The clickable equation ─────────────────────────────────────────── */

export interface EquationInput {
  opening: { countId: string; countDate: string; valueAgorot: number };
  closing: { countId: string; countDate: string; valueAgorot: number };
  /** Food purchases on receipt dates, (opening, closing] (agorot). */
  purchasesAgorot: number;
  /** Credits RECEIVED in the period (agorot, ≥ 0). */
  creditsAgorot: number;
  salesAgorot: number | null;
  salesSource: 'pos' | 'manual' | null;
}

export type TermKey = 'opening' | 'purchases' | 'credits' | 'closing';

export interface EquationTerm {
  key: TermKey;
  /** +1 adds to usage, −1 subtracts. */
  sign: 1 | -1;
  agorot: number;
  drill: Drill;
}

export interface Equation {
  terms: EquationTerm[];
  /** Σ sign × agorot: the food actually used in the period (agorot). */
  usageAgorot: number;
  sales: { agorot: number | null; drill: Drill };
  /** usage ÷ sales in bp (half-up), or null without positive sales or with negative usage. */
  actualBp: number | null;
}

export function equation(p: EquationInput): Equation {
  const from = p.opening.countDate;
  const to = p.closing.countDate;
  const terms: EquationTerm[] = [
    { key: 'opening', sign: 1, agorot: p.opening.valueAgorot, drill: { kind: 'count', countId: p.opening.countId } },
    { key: 'purchases', sign: 1, agorot: p.purchasesAgorot, drill: { kind: 'invoices', from, to } },
    { key: 'credits', sign: -1, agorot: p.creditsAgorot, drill: { kind: 'credits', from, to } },
    { key: 'closing', sign: -1, agorot: p.closing.valueAgorot, drill: { kind: 'count', countId: p.closing.countId } },
  ];
  const usageAgorot = terms.reduce((a, t) => a + t.sign * t.agorot, 0);
  const sales = p.salesAgorot;
  const actualBp =
    sales != null && sales > 0 && usageAgorot >= 0 ? Number(roundHalfUp(BigInt(usageAgorot) * 10_000n, BigInt(sales))) : null;
  return {
    terms,
    usageAgorot,
    sales: { agorot: sales, drill: { kind: 'sales', countId: p.closing.countId, source: p.salesSource } },
    actualBp,
  };
}

/* ── 2. The period sparkline ───────────────────────────────────────────── */

export interface PeriodPoint {
  closingCountId: string;
  closingDate: string;
  /** null when the period has no honest % (no opening, no sales, implausible). */
  actualBp: number | null;
  implausible?: boolean;
}

export interface Series {
  /** Oldest → newest; a null `bp` is a gap in the line, never a zero. */
  points: Array<{ closingCountId: string; closingDate: string; bp: number | null }>;
  targetBp: number;
  /** Scale for the chart: min/max over the real points and the target. */
  minBp: number;
  maxBp: number;
  /** The newest point with a value, and its change from the one before it (bp), or null. */
  latest: { closingDate: string; bp: number; deltaBp: number | null } | null;
}

export function periodSeries(periods: readonly PeriodPoint[], targetBp: number, max = 12): Series {
  const sorted = [...periods].sort((a, b) => (a.closingDate < b.closingDate ? -1 : a.closingDate > b.closingDate ? 1 : 0)).slice(-max);
  const points = sorted.map((p) => ({
    closingCountId: p.closingCountId,
    closingDate: p.closingDate,
    bp: p.implausible ? null : p.actualBp,
  }));
  const values = points.map((p) => p.bp).filter((x): x is number => x != null);
  const withTarget = [...values, targetBp];
  const real = points.filter((p) => p.bp != null) as Array<{ closingCountId: string; closingDate: string; bp: number }>;
  const last = real[real.length - 1];
  const prev = real[real.length - 2];
  return {
    points,
    targetBp,
    minBp: Math.min(...withTarget),
    maxBp: Math.max(...withTarget),
    latest: last ? { closingDate: last.closingDate, bp: last.bp, deltaBp: prev ? last.bp - prev.bp : null } : null,
  };
}

/* ── 3. Category split ─────────────────────────────────────────────────── */

export interface CategoryFlow {
  /** null = uncategorised. */
  category: string | null;
  openingAgorot: number;
  purchasesAgorot: number;
  creditsAgorot: number;
  closingAgorot: number;
}

export interface CategoryRow {
  category: string | null;
  usageAgorot: number;
  /** Share of the total positive usage (bp); the shares sum to exactly 10,000 when any is > 0. */
  shareBp: number;
}

/**
 * Usage per category = opening + purchases − credits − closing, largest first.
 * Categories beyond `top` fold into one "other" row (category `'__other__'`).
 * A category with negative usage (stock grew faster than purchases explain) is
 * kept with a 0 share, so a counting slip shows up instead of hiding.
 */
export function categorySplit(flows: readonly CategoryFlow[], top = 6): CategoryRow[] {
  const byCat = new Map<string | null, number>();
  for (const f of flows) {
    const u = f.openingAgorot + f.purchasesAgorot - f.creditsAgorot - f.closingAgorot;
    byCat.set(f.category, (byCat.get(f.category) ?? 0) + u);
  }
  let rows = [...byCat].map(([category, usageAgorot]) => ({ category, usageAgorot }));
  rows.sort((a, b) => b.usageAgorot - a.usageAgorot || String(a.category).localeCompare(String(b.category)));
  if (rows.length > top) {
    const head = rows.slice(0, top - 1);
    const rest = rows.slice(top - 1).reduce((a, r) => a + r.usageAgorot, 0);
    rows = [...head, { category: '__other__', usageAgorot: rest }];
  }
  const shares = sharesBp(rows.map((r) => Math.max(0, r.usageAgorot)));
  return rows.map((r, i) => ({ ...r, shareBp: shares[i]! }));
}

/* ── 4. Top-10 unexplained usage ───────────────────────────────────────── */

export interface ProductUsage {
  productId: string;
  name: string;
  nameEn?: string | null;
  /** opening + received − closing for this product, valued (agorot). */
  actualUsageAgorot: number;
  /** What the dishes sold should have used (recipes × POS), valued (agorot); null = no recipe uses it. */
  theoreticalUsageAgorot: number | null;
}

export interface UnexplainedRow {
  productId: string;
  name: string;
  nameEn: string | null;
  actualUsageAgorot: number;
  theoreticalUsageAgorot: number | null;
  /** actual − theoretical (agorot, > 0); with no recipe, the whole actual usage. */
  gapAgorot: number;
  /** No recipe explains any of it (shown as such, not as waste). */
  noRecipe: boolean;
}

/**
 * The products whose actual usage most exceeds what the recipes explain,
 * biggest ₪ gap first (ties by name). Only positive gaps: using LESS than the
 * recipes say is not "unexplained usage". With no POS theory at all
 * (`hasTheory` false), returns [] instead of ranking raw usage as a loss.
 */
export function topUnexplained(rows: readonly ProductUsage[], hasTheory: boolean, n = 10): UnexplainedRow[] {
  if (!hasTheory) return [];
  return rows
    .map((r) => {
      const theory = r.theoreticalUsageAgorot;
      return {
        productId: r.productId,
        name: r.name,
        nameEn: r.nameEn ?? null,
        actualUsageAgorot: r.actualUsageAgorot,
        theoreticalUsageAgorot: theory,
        gapAgorot: r.actualUsageAgorot - (theory ?? 0),
        noRecipe: theory == null,
      };
    })
    .filter((r) => r.gapAgorot > 0)
    .sort((a, b) => b.gapAgorot - a.gapAgorot || a.name.localeCompare(b.name, 'he'))
    .slice(0, n);
}
