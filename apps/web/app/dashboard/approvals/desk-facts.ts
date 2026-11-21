/**
 * The approvals desk's facts (DS3-04 spec §2.1). Pure: row data in, plain data out — no React, no tRPC,
 * no translator. The only imports are @restomatch/types (the exact number parser) and `decisionActions`
 * from ./vocab (pinned by vocab.test.ts); the text layer (desk-text.ts) and the views turn these facts
 * into words.
 *
 * Money is exact (R8): a NUMERIC string never meets Number() / parseFloat here. Strings become bigint
 * through units4() / deltaAgorot(); a float appears only as a display prop (toNumber4 for prices and
 * quantities, Number(agorot) for <Money agorot>). The calculation line's result is always the stored |Δ|:
 * it is factorised only when the exact product equals it, otherwise the honest fallback (§2.1.2).
 */
import { parseNumberInput } from '@restomatch/types';
import { decisionActions } from './vocab';

export type GapType =
  | 'PRICE_HIGHER'
  | 'PRICE_LOWER'
  | 'QTY_SHORT'
  | 'QTY_OVER'
  | 'UNORDERED_ITEM'
  | 'MISSING_ON_INVOICE'
  | 'UNIT_MISMATCH'
  | 'UNORDERED_ARRIVAL'
  | 'DUPLICATE_INVOICE'
  | 'DATE_ANOMALY'
  | 'VAT_MISMATCH'
  | 'TOTAL_MISMATCH';
export type Tier = 'block' | 'warn' | 'info';

/** The row fields the facts read. A QueueItem satisfies it structurally; tests pass literals.
 *  The three price fields are optional so S1 compiles before S2's router seam lands. */
export interface GapInput {
  id: string;
  type: string; // a GapType at runtime
  severity: string; // 'info' | 'warn' | 'block'
  deltaAmount: string | null; // NUMERIC(12,2) string, may be signed
  expectedValue: string | null; // NUMERIC(12,4)
  actualValue: string | null; // NUMERIC(12,4)
  toleranceUsed: string | null; // engine text, English
  qtyBilled: string | null; // NUMERIC(12,3), billed unit
  billedUnit: string | null;
  qtyOrdered: string | null; // NUMERIC(12,3), PO unit; null for an orphan PO
  orderedUnit: string | null;
  qtyReceived: string | null; // NUMERIC(12,3); only on QTY_* / MISSING rows
  poId: string | null;
  poDate?: Date | string | null;
  invoiceId: string | null;
  invoiceLineId: string | null;
  claimable: boolean;
  claimAgorot: number;
  invoiceStatus?: string | null;
  hasScan?: boolean;
  unitPriceExpected?: string | null; // S2 · NUMERIC(12,4); null for an orphan PO
  unitPriceBilled?: string | null; // S2 · NUMERIC(12,4)
  lineTotal?: string | null; // S2 · NUMERIC(12,2)
}

// ── exact arithmetic (never a float in a calculation) ─────────────────────────────────────────

/** NUMERIC string → integer at scale 4 (1n = 0.0001), or null. Strips one leading '-' itself, then
 *  parseNumberInput(rest, { scale: 4, grouping: false }); 'ok' → BigInt(scaled) × sign. */
export function units4(raw: string | null | undefined): bigint | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const negative = s.startsWith('-');
  const cell = parseNumberInput(negative ? s.slice(1) : s, { scale: 4, grouping: false });
  if (cell.kind !== 'ok') return null;
  const v = BigInt(cell.scaled);
  return negative ? -v : v;
}

export function abs4(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** |deltaAmount| in integer agorot (scale-4 value ÷ 100; NUMERIC(12,2) divides exactly), or null.
 *  A value with more decimals than NUMERIC(12,2) holds rounds half-up rather than truncating. */
export function deltaAgorot(g: Pick<GapInput, 'deltaAmount'>): bigint | null {
  const v = units4(g.deltaAmount);
  return v == null ? null : (abs4(v) + 50n) / 100n;
}

/** qty × price, both scale 4 and ≥ 0 → agorot, half-up once (the engine's mulIls rule, done exactly). */
export function mulAgorot(qty4: bigint, price4: bigint): bigint {
  return (qty4 * price4 + 500_000n) / 1_000_000n;
}

/** Display only (formatNumber / <Money value>); never fed back into a calculation. */
export function toNumber4(v: bigint): number {
  return Number(v) / 10_000;
}

/** packages/matching units.ts `norm`: trim, lower, strip ASCII quotes/dots/space and ׳ ״. */
function unitKey(unit: string): string {
  return unit.trim().toLowerCase().replace(/["'.\s׳״]/g, '');
}

/** Both non-null and equal after the engine's normalisation ("ק״ג" = 'ק"ג'). */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && unitKey(a) === unitKey(b);
}

// ── classification ────────────────────────────────────────────────────────────────────────────

export const P90_PREFIX = 'actual exceeds historical p90';
export const BILLED_OVER_RECEIVED = 'billed quantity exceeds received quantity';
export type PriceBasis = 'order' | 'contract' | 'p90' | 'expected';

const isPriceType = (type: string): boolean => type === 'PRICE_HIGHER' || type === 'PRICE_LOWER';

/** PRICE_* only (else null): toleranceUsed startsWith P90_PREFIX → 'p90'; poId null → 'expected';
 *  unitPriceExpected null/undefined → 'contract'; units4(E) !== units4(unitPriceExpected) → 'contract'; else 'order'. */
export function priceBasisOf(g: GapInput): PriceBasis | null {
  if (!isPriceType(g.type)) return null;
  if ((g.toleranceUsed ?? '').startsWith(P90_PREFIX)) return 'p90';
  if (g.poId == null) return 'expected';
  if (g.unitPriceExpected == null) return 'contract';
  return units4(g.expectedValue) !== units4(g.unitPriceExpected) ? 'contract' : 'order';
}

export type QtyOverKind = '5a' | '5b';
/** QTY_OVER only: toleranceUsed === BILLED_OVER_RECEIVED → '5b' (E = received, A = billed); else '5a'. */
export function qtyOverKindOf(g: GapInput): QtyOverKind | null {
  if (g.type !== 'QTY_OVER') return null;
  return g.toleranceUsed === BILLED_OVER_RECEIVED ? '5b' : '5a';
}

export type EvidenceKind = 'table' | 'calcOnly' | 'fact';
const TABLE_TYPES: ReadonlySet<string> = new Set([
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'MISSING_ON_INVOICE',
  'UNORDERED_ITEM',
]);
/** PRICE_HIGHER/LOWER, QTY_SHORT, QTY_OVER, MISSING_ON_INVOICE, UNORDERED_ITEM → 'table';
 *  VAT_MISMATCH, TOTAL_MISMATCH → 'calcOnly'; DUPLICATE_INVOICE, UNORDERED_ARRIVAL, UNIT_MISMATCH,
 *  DATE_ANOMALY and anything unknown → 'fact'. */
export function evidenceKindOf(type: string): EvidenceKind {
  if (TABLE_TYPES.has(type)) return 'table';
  if (type === 'VAT_MISMATCH' || type === 'TOTAL_MISMATCH') return 'calcOnly';
  return 'fact';
}

export type AmountBasis = 'excl' | 'incl' | 'vat';
/** DUPLICATE_INVOICE, UNORDERED_ARRIVAL → 'incl'; VAT_MISMATCH → 'vat'; else 'excl' (= packages/api lib/claims.ts vatBasisOf). */
export function amountBasisOf(type: string): AmountBasis {
  if (type === 'DUPLICATE_INVOICE' || type === 'UNORDERED_ARRIVAL') return 'incl';
  if (type === 'VAT_MISMATCH') return 'vat';
  return 'excl';
}

/** R6: a row whose ₪ has another basis than the before-VAT batch total stays out of a batch and of "approve the
 *  whole invoice": VAT_MISMATCH → 'vat'; else null. (DUPLICATE_INVOICE and TOTAL_MISMATCH are block rows, refused
 *  anyway; UNORDERED_ARRIVAL is never claimable and adds ₪0.) The server is unchanged and still accepts them. */
export function batchBasisBlock(g: { type: string }): 'vat' | null {
  return g.type === 'VAT_MISMATCH' ? 'vat' : null;
}

// ── tiers and the head sentence ───────────────────────────────────────────────────────────────

export const TIER_ORDER: readonly Tier[] = ['block', 'warn', 'info'];

/** 'block' | 'warn' | anything else → 'info'. */
export function tierOf(g: { severity: string }): Tier {
  return g.severity === 'block' ? 'block' : g.severity === 'warn' ? 'warn' : 'info';
}

/** Server order is block → warn → info, so tiers are contiguous. Empty tiers omitted; input order kept.
 *  `open` counts rows where isOpen(r); it is null for the LAST tier when hasMore (a partial count is never shown). */
export function groupByTier<R extends { severity: string }>(
  rows: readonly R[],
  isOpen: (r: R) => boolean,
  hasMore: boolean,
): Array<{ tier: Tier; rows: R[]; open: number | null }> {
  const byTier: Record<Tier, R[]> = { block: [], warn: [], info: [] };
  for (const r of rows) byTier[tierOf(r)].push(r);
  const out: Array<{ tier: Tier; rows: R[]; open: number | null }> = [];
  for (const tier of TIER_ORDER) {
    const tierRows = byTier[tier];
    if (tierRows.length > 0) out.push({ tier, rows: tierRows, open: tierRows.filter(isOpen).length });
  }
  const last = out[out.length - 1];
  if (hasMore && last) last.open = null;
  return out;
}

export type BlockClause = 'none' | 'one' | 'both' | 'all' | 'some';
export type HeadParts =
  | { kind: 'empty' }
  | { kind: 'some'; count: number; blockers: number; claimableIls: number; clause: BlockClause };

const wholeCount = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/** From the (optimistic) server summary, never from loaded rows. n = count, b = min(blockers, n):
 *  n = 0 → empty · b = 0 → none · n = 1, b = 1 → one · n = b = 2 → both · n = b ≥ 3 → all · 1 ≤ b < n → some. */
export function headParts(s: { count: number; blockers: number; claimableIls: number }): HeadParts {
  const n = wholeCount(s.count);
  if (n === 0) return { kind: 'empty' };
  const b = Math.min(wholeCount(s.blockers), n);
  const clause: BlockClause = b === 0 ? 'none' : n === 1 ? 'one' : b < n ? 'some' : n === 2 ? 'both' : 'all';
  return { kind: 'some', count: n, blockers: b, claimableIls: s.claimableIls, clause };
}

// ── the three-way table ───────────────────────────────────────────────────────────────────────

export type Cell = 'ordered' | 'received' | 'billed';
/** Each Word is the suffix of a message key `desk.table.<word>` (§6.1). */
export type Word = 'noPriceOnReceipt' | 'noOrderPrice' | 'notChecked' | 'noReceipt' | 'unknown' | 'notOrdered' | 'notBilled';
export type CellValue =
  | { kind: 'qty'; v4: bigint; unit: string | null }
  | { kind: 'price'; v4: bigint; per: string | null; contract?: true }
  | { kind: 'word'; word: Word };
export type GapNote =
  | { kind: 'qty'; v4: bigint; unit: string | null; direction: 'less' | 'more' }
  | { kind: 'pct'; ratio: number; direction: 'less' | 'more'; p90: boolean } // ratio = |A−E|/E via BigInt, null-safe
  | null;
export interface TableFacts {
  qty: Record<Cell, CellValue>;
  price: Record<Cell, CellValue>;
  flagged: { row: 'qty' | 'price'; cell: Cell }; // exactly one per gap
  gap: GapNote;
  tone: 'leak' | 'warn' | 'neutral'; // block → leak, warn → warn, info → neutral
}

const word = (w: Word): CellValue => ({ kind: 'word', word: w });

/** qty(x, U): the quantity, or a word when x is null / unparsable (`unknown` unless the table names another). */
function qtyCell(raw: string | null | undefined, unit: string | null, whenNull: Word = 'unknown'): CellValue {
  const v4 = units4(raw);
  return v4 == null ? word(whenNull) : { kind: 'qty', v4, unit };
}

/** price(x, per): the unit price, or a word when x is null / unparsable. */
function priceCell(raw: string | null | undefined, per: string | null, whenNull: Word, contract = false): CellValue {
  const v4 = units4(raw);
  if (v4 == null) return word(whenNull);
  return contract ? { kind: 'price', v4, per, contract: true } : { kind: 'price', v4, per };
}

function toneOf(g: { severity: string }): TableFacts['tone'] {
  const tier = tierOf(g);
  return tier === 'block' ? 'leak' : tier === 'warn' ? 'warn' : 'neutral';
}

/** |A−E| / E in BigInt (`abs4(A−E) * 1_000_000n / E` → Number / 1e6); E ≤ 0 or a missing figure → null. */
function pctNote(a: bigint | null, e: bigint | null, p90: boolean): GapNote {
  if (a == null || e == null || e <= 0n) return null;
  const ratio = Number((abs4(a - e) * 1_000_000n) / e) / 1e6;
  return { kind: 'pct', ratio, direction: a > e ? 'more' : 'less', p90 };
}

/** The written quantity gap (from − minus, in the PO unit); null when a figure is missing or the difference is
 *  not positive (the flagged cell keeps its tone, as for E = 0). */
function qtyNote(from: bigint | null, minus: bigint | null, unit: string | null, direction: 'less' | 'more'): GapNote {
  if (from == null || minus == null) return null;
  const v4 = from - minus;
  return v4 > 0n ? { kind: 'qty', v4, unit, direction } : null;
}

/** Null unless evidenceKindOf(type) === 'table'. Every value comes from the row (no detail, no pending cell). §2.1.1. */
export function tableOf(g: GapInput): TableFacts | null {
  if (evidenceKindOf(g.type) !== 'table') return null;
  const Uo = g.orderedUnit;
  const Ub = g.billedUnit;
  const A = units4(g.actualValue);
  const E = units4(g.expectedValue);
  const tone = toneOf(g);
  const noLine = g.invoiceLineId == null;
  // A null price is `noOrderPrice` in the ordered column and `notBilled` in the billed column without an invoice line.
  const billedWhenNull: Word = noLine ? 'notBilled' : 'unknown';
  const orderPrice = (): CellValue => priceCell(g.unitPriceExpected, Uo, 'noOrderPrice');
  const billedQtyOrNot = (): CellValue => (noLine ? word('notBilled') : qtyCell(g.qtyBilled, Ub));
  const billedPriceOrNot = (): CellValue => (noLine ? word('notBilled') : priceCell(g.unitPriceBilled, Ub, 'unknown'));

  switch (g.type) {
    case 'PRICE_HIGHER':
    case 'PRICE_LOWER': {
      const basis = priceBasisOf(g);
      const qty: Record<Cell, CellValue> = {
        ordered: basis === 'expected' ? word('unknown') : qtyCell(g.qtyOrdered, Uo),
        received: word('notChecked'),
        billed: qtyCell(g.qtyBilled, Ub),
      };
      let price: Record<Cell, CellValue>;
      if (basis === 'contract') {
        price = {
          ordered: priceCell(g.expectedValue, Uo, 'noOrderPrice', true),
          received: word('noPriceOnReceipt'),
          billed: priceCell(g.actualValue, Uo, billedWhenNull),
        };
      } else if (basis === 'p90') {
        // E is the supplier's 90th percentile, never an order price: the ordered column shows the PO's own price.
        price = { ordered: orderPrice(), received: word('noPriceOnReceipt'), billed: priceCell(g.actualValue, Uo, billedWhenNull) };
      } else if (basis === 'expected') {
        price = {
          ordered: priceCell(g.expectedValue, Ub, 'noOrderPrice'),
          received: word('noPriceOnReceipt'),
          billed: priceCell(g.actualValue, Ub, billedWhenNull),
        };
      } else {
        price = {
          ordered: priceCell(g.expectedValue, Uo ?? Ub, 'noOrderPrice'),
          received: word('noPriceOnReceipt'),
          billed: priceCell(g.actualValue, Uo ?? Ub, billedWhenNull),
        };
      }
      return { qty, price, flagged: { row: 'price', cell: 'billed' }, gap: pctNote(A, E, basis === 'p90'), tone };
    }
    case 'QTY_OVER': {
      if (qtyOverKindOf(g) === '5b') {
        // 5b: E = what was received (summed over deliveries), A = what was billed, both in the PO unit.
        return {
          qty: { ordered: qtyCell(g.qtyOrdered, Uo), received: qtyCell(g.expectedValue, Uo), billed: qtyCell(g.qtyBilled, Ub) },
          price: { ordered: orderPrice(), received: word('noPriceOnReceipt'), billed: priceCell(g.unitPriceBilled, Ub, billedWhenNull) },
          flagged: { row: 'qty', cell: 'received' },
          gap: qtyNote(A, E, Uo, 'less'),
          tone,
        };
      }
      // 5a: E = ordered, A = received.
      return {
        qty: { ordered: qtyCell(g.expectedValue, Uo), received: qtyCell(g.actualValue, Uo), billed: billedQtyOrNot() },
        price: { ordered: orderPrice(), received: word('noPriceOnReceipt'), billed: billedPriceOrNot() },
        flagged: { row: 'qty', cell: 'received' },
        gap: qtyNote(A, E, Uo, 'more'),
        tone,
      };
    }
    case 'QTY_SHORT':
      return {
        qty: { ordered: qtyCell(g.expectedValue, Uo), received: qtyCell(g.actualValue, Uo), billed: billedQtyOrNot() },
        price: { ordered: orderPrice(), received: word('noPriceOnReceipt'), billed: billedPriceOrNot() },
        flagged: { row: 'qty', cell: 'received' },
        gap: qtyNote(E, A, Uo, 'less'),
        tone,
      };
    case 'MISSING_ON_INVOICE':
      return {
        qty: { ordered: qtyCell(g.expectedValue, Uo), received: qtyCell(g.qtyReceived, Uo, 'noReceipt'), billed: word('notBilled') },
        price: { ordered: orderPrice(), received: word('noPriceOnReceipt'), billed: word('notBilled') },
        flagged: { row: 'qty', cell: 'billed' },
        gap: null,
        tone,
      };
    default:
      // UNORDERED_ITEM: A is the billed quantity (the invoice line's own), nothing was ordered or received.
      return {
        qty: { ordered: word('notOrdered'), received: word('noReceipt'), billed: qtyCell(g.actualValue, Ub) },
        price: { ordered: word('notOrdered'), received: word('noPriceOnReceipt'), billed: priceCell(g.unitPriceBilled, Ub, billedWhenNull) },
        flagged: { row: 'qty', cell: 'ordered' },
        gap: null,
        tone,
      };
  }
}

// ── the calculation line (the result is always the stored |Δ|) ───────────────────────────────

export type TermLabel = 'billed' | 'notReceived' | 'overOrder' | 'short' | 'notBilled' | 'notOrdered';
export type CalcTerm =
  | { kind: 'qty'; v4: bigint; unit: string | null; label: TermLabel }
  | { kind: 'priceDiff'; v4: bigint; per: string; direction: 'more' | 'less'; basis: PriceBasis }
  | { kind: 'price'; v4: bigint; per: string | null; source: 'billed' | 'order' }
  | { kind: 'money'; v4: bigint; label: 'vatPrinted' | 'vatByRate' | 'sumOfLines' | 'subtotal' };
export type CalcFacts =
  | { kind: 'times'; left: CalcTerm; right: CalcTerm; resultAgorot: bigint; basis: 'excl' }
  | { kind: 'minus'; left: CalcTerm; right: CalcTerm; resultAgorot: bigint; basis: 'excl' | 'vat' }
  | { kind: 'fallback'; resultAgorot: bigint; label: 'fallback' | 'lineTotal'; basis: 'excl'; why: 'units' | 'mismatch' | 'missing' }
  | { kind: 'none' };

type QtyTerm = Extract<CalcTerm, { kind: 'qty' }>;
type FactorTerm = Extract<CalcTerm, { kind: 'priceDiff' | 'price' }>;
type MoneyTerm = Extract<CalcTerm, { kind: 'money' }>;
type FallbackFacts = Extract<CalcFacts, { kind: 'fallback' }>;

function fallback(resultAgorot: bigint, why: FallbackFacts['why'], label: FallbackFacts['label'] = 'fallback'): CalcFacts {
  return { kind: 'fallback', resultAgorot, label, basis: 'excl', why };
}

/** "check" for times: both factors ≥ 0 and mulAgorot(left, right) === Δa; otherwise the honest fallback. */
function timesOrFallback(left: QtyTerm, right: FactorTerm, delta: bigint, label: FallbackFacts['label']): CalcFacts {
  if (left.v4 < 0n || right.v4 < 0n || mulAgorot(left.v4, right.v4) !== delta) return fallback(delta, 'mismatch', label);
  return { kind: 'times', left, right, resultAgorot: delta, basis: 'excl' };
}

/** R4: the engine stores |A − E| for both directions, so the LARGER figure goes on the left; each term keeps its
 *  label. "check" = abs4(left − right) / 100n === Δa with no remainder. */
function minusOrFallback(termA: MoneyTerm, termE: MoneyTerm, delta: bigint, basis: 'excl' | 'vat'): CalcFacts {
  const [left, right] = termA.v4 >= termE.v4 ? [termA, termE] : [termE, termA];
  const diff = abs4(left.v4 - right.v4);
  if (diff % 100n !== 0n || diff / 100n !== delta) return fallback(delta, 'mismatch');
  return { kind: 'minus', left, right, resultAgorot: delta, basis };
}

/** Factorised only when the exact product (half-up to the agora) equals the stored |Δ|; otherwise the honest
 *  fallback (no factors, the result and its label). Never recomputes money. A 'minus' always puts the LARGER
 *  figure on the left (R4: the engine stores |A−E| for both directions). Table in §2.1.2. */
export function calcOf(g: GapInput): CalcFacts {
  const delta = deltaAgorot(g);
  if (delta == null) return { kind: 'none' };
  const A = units4(g.actualValue);
  const E = units4(g.expectedValue);
  const Uo = g.orderedUnit;
  const Ub = g.billedUnit;

  switch (g.type) {
    case 'PRICE_HIGHER':
    case 'PRICE_LOWER': {
      const qb = units4(g.qtyBilled);
      if (qb == null || A == null || E == null) return fallback(delta, 'missing');
      // Precondition: Uo null ? Ub non-null : sameUnit(Ub, Uo) — the billed quantity is counted in the unit the
      // price difference is per (a converted kg↔g line falls back).
      const per = Uo ?? Ub;
      if (per == null || (Uo != null && !sameUnit(Ub, Uo))) return fallback(delta, 'units');
      return timesOrFallback(
        { kind: 'qty', v4: qb, unit: Ub, label: 'billed' },
        { kind: 'priceDiff', v4: abs4(A - E), per, direction: A > E ? 'more' : 'less', basis: priceBasisOf(g) ?? 'order' },
        delta,
        'fallback',
      );
    }
    case 'QTY_OVER': {
      if (qtyOverKindOf(g) === '5b') {
        const pb = units4(g.unitPriceBilled);
        if (A == null || E == null || pb == null) return fallback(delta, 'missing');
        if (!sameUnit(Ub, Uo)) return fallback(delta, 'units');
        return timesOrFallback(
          { kind: 'qty', v4: A - E, unit: Uo, label: 'notReceived' },
          { kind: 'price', v4: pb, per: Ub, source: 'billed' },
          delta,
          'fallback',
        );
      }
      const pexp = units4(g.unitPriceExpected);
      if (A == null || E == null || pexp == null) return fallback(delta, 'missing');
      return timesOrFallback(
        { kind: 'qty', v4: A - E, unit: Uo, label: 'overOrder' },
        { kind: 'price', v4: pexp, per: Uo, source: 'order' },
        delta,
        'fallback',
      );
    }
    case 'QTY_SHORT': {
      const pexp = units4(g.unitPriceExpected);
      if (A == null || E == null || pexp == null) return fallback(delta, 'missing');
      return timesOrFallback(
        { kind: 'qty', v4: E - A, unit: Uo, label: 'short' },
        { kind: 'price', v4: pexp, per: Uo, source: 'order' },
        delta,
        'fallback',
      );
    }
    case 'MISSING_ON_INVOICE': {
      const pexp = units4(g.unitPriceExpected);
      if (E == null || pexp == null) return fallback(delta, 'missing');
      return timesOrFallback(
        { kind: 'qty', v4: E, unit: Uo, label: 'notBilled' },
        { kind: 'price', v4: pexp, per: Uo, source: 'order' },
        delta,
        'fallback',
      );
    }
    case 'UNORDERED_ITEM': {
      // Δ is the printed line total: the factors show only when Qb × Pb equals it; otherwise "the line total".
      const qb = units4(g.qtyBilled);
      const pb = units4(g.unitPriceBilled);
      if (qb == null || pb == null) return fallback(delta, 'missing', 'lineTotal');
      return timesOrFallback(
        { kind: 'qty', v4: qb, unit: Ub, label: 'notOrdered' },
        { kind: 'price', v4: pb, per: Ub, source: 'billed' },
        delta,
        'lineTotal',
      );
    }
    case 'VAT_MISMATCH':
      if (A == null || E == null) return fallback(delta, 'missing');
      return minusOrFallback({ kind: 'money', v4: A, label: 'vatPrinted' }, { kind: 'money', v4: E, label: 'vatByRate' }, delta, 'vat');
    case 'TOTAL_MISMATCH':
      // E = the sum of the lines, A = the printed subtotal.
      if (A == null || E == null) return fallback(delta, 'missing');
      return minusOrFallback({ kind: 'money', v4: A, label: 'subtotal' }, { kind: 'money', v4: E, label: 'sumOfLines' }, delta, 'excl');
    default:
      // DUPLICATE_INVOICE, UNORDERED_ARRIVAL, UNIT_MISMATCH, DATE_ANOMALY and anything unknown: a fact, no line.
      return { kind: 'none' };
  }
}

/** Each SourceKey is the suffix of `desk.calc.src.<key>` (§6.1); kind maps to DS3-01 CalcSourceKind. */
export type SourceKey =
  | 'invoice'
  | 'scan'
  | 'order'
  | 'engine'
  | 'billedCounted'
  | 'countedOrdered'
  | 'orderedCounted'
  | 'pricesOrder'
  | 'pricesContract'
  | 'pricesP90'
  | 'pricesExpected';
export interface SourceFact {
  term: 'left' | 'right';
  key: SourceKey;
  kind: 'scan' | 'count' | 'order' | 'invoice';
  values?: { billed?: bigint; counted?: bigint; ordered?: bigint; expected?: bigint; unit?: string | null };
  /** `order` sources carry the order's date (§2.1.3): the view picks `desk.calc.src.order` with it, or `orderNoDate`. */
  poDate?: Date | string | null;
}

const PRICE_SOURCE: Record<PriceBasis, SourceKey> = {
  order: 'pricesOrder',
  contract: 'pricesContract',
  p90: 'pricesP90',
  expected: 'pricesExpected',
};

/** The source of one shown term, keyed by its label / kind — never by its position (a 'minus' may swap). */
function sourceOf(term: CalcTerm, side: 'left' | 'right', g: GapInput): SourceFact {
  const billedKind: SourceFact = g.hasScan ? { term: side, key: 'scan', kind: 'scan' } : { term: side, key: 'invoice', kind: 'invoice' };
  const order: SourceFact = { term: side, key: 'order', kind: 'order', poDate: g.poDate ?? null };
  const A = units4(g.actualValue) ?? undefined;
  const E = units4(g.expectedValue) ?? undefined;
  const unit = g.orderedUnit;
  if (term.kind === 'qty') {
    if (term.label === 'notReceived') return { term: side, key: 'billedCounted', kind: 'count', values: { billed: A, counted: E, unit } };
    if (term.label === 'overOrder') return { term: side, key: 'countedOrdered', kind: 'count', values: { counted: A, ordered: E, unit } };
    if (term.label === 'short') return { term: side, key: 'orderedCounted', kind: 'count', values: { ordered: E, counted: A, unit } };
    if (term.label === 'notBilled') return order;
    return billedKind; // 'billed' (PRICE) and 'notOrdered' (UNORDERED_ITEM): read off the invoice
  }
  if (term.kind === 'priceDiff') return { term: side, key: PRICE_SOURCE[term.basis], kind: 'invoice', values: { billed: A, expected: E } };
  if (term.kind === 'price') return term.source === 'billed' ? billedKind : order;
  // money: the printed figure is read off the invoice; the other one the check computed.
  return term.label === 'vatPrinted' || term.label === 'subtotal' ? billedKind : { term: side, key: 'engine', kind: 'invoice' };
}

/** One per shown term for 'times' / 'minus'; [] for 'fallback' / 'none'. Keyed by the term's LABEL, never by its
 *  position (a 'minus' may swap its terms). Table in §2.1.3. */
export function sourcesOf(calc: CalcFacts, g: GapInput): SourceFact[] {
  if (calc.kind !== 'times' && calc.kind !== 'minus') return [];
  return [sourceOf(calc.left, 'left', g), sourceOf(calc.right, 'right', g)];
}

// ── money lines ───────────────────────────────────────────────────────────────────────────────

/** Null unless claimable and BigInt(claimAgorot) !== |Δ| agorot; claim 0 → 'none'; 0 < claim < |Δ| → 'capped'.
 *  A claimable row with a ₪0 claim is always 'none' (R5: a ₪0 claim is never printed on the button). */
export function claimNoteOf(g: GapInput): { kind: 'capped' | 'none'; claimAgorot: number; deltaAgorot: number } | null {
  if (!g.claimable) return null;
  const delta = deltaAgorot(g);
  const claim = Number.isFinite(g.claimAgorot) ? Math.trunc(g.claimAgorot) : 0;
  if (claim <= 0) return { kind: 'none', claimAgorot: 0, deltaAgorot: delta == null ? 0 : Number(delta) };
  if (delta == null || BigInt(claim) >= delta) return null;
  return { kind: 'capped', claimAgorot: claim, deltaAgorot: Number(delta) };
}

/** Each CostForm is the suffix of `desk.cost.<form>` (§6.1). */
export type CostForm =
  | 'priceOrder'
  | 'priceContract'
  | 'priceP90'
  | 'qtyNotReceived'
  | 'qtyOverOrder'
  | 'qtyShort'
  | 'unordered'
  | 'duplicate'
  | 'vat'
  | 'vatBelow'
  | 'total'
  | 'totalBelow'
  | 'other';

/** "תשלמו ל{ספק} ₪X …": amount = |Δ| (0n when unparsable). PRICE order → priceOrder, contract → priceContract,
 *  p90 → priceP90, expected → other · QTY_OVER 5b → qtyNotReceived (A−E, Uo) · 5a → qtyOverOrder (A−E) ·
 *  QTY_SHORT → qtyShort (E−A) · a qty form with a null unit → other · UNORDERED_ITEM → unordered ·
 *  DUPLICATE_INVOICE → duplicate · VAT_MISMATCH: A ≥ E → vat, A < E → vatBelow · TOTAL_MISMATCH (E = sum of lines,
 *  A = printed subtotal): A ≥ E → total, A < E → totalBelow (a lower printed figure is never "מעל", R4) ·
 *  A or E unparsable on VAT/TOTAL → other · anything else → other.
 *  A qty form whose quantity is missing or not positive is also `other` (no "0 שלא התקבלו"). */
export function costOf(g: GapInput): { form: CostForm; amountAgorot: bigint; qty4?: bigint; unit?: string | null } {
  const amountAgorot = deltaAgorot(g) ?? 0n;
  const A = units4(g.actualValue);
  const E = units4(g.expectedValue);
  const qtyForm = (form: CostForm, qty4: bigint | null) => {
    const unit = g.orderedUnit;
    if (qty4 == null || qty4 <= 0n || unit == null || unit.trim() === '') return { form: 'other' as const, amountAgorot };
    return { form, amountAgorot, qty4, unit };
  };
  switch (g.type) {
    case 'PRICE_HIGHER':
    case 'PRICE_LOWER': {
      const basis = priceBasisOf(g);
      const form: CostForm =
        basis === 'order' ? 'priceOrder' : basis === 'contract' ? 'priceContract' : basis === 'p90' ? 'priceP90' : 'other';
      return { form, amountAgorot };
    }
    case 'QTY_OVER':
      return qtyForm(qtyOverKindOf(g) === '5b' ? 'qtyNotReceived' : 'qtyOverOrder', A != null && E != null ? A - E : null);
    case 'QTY_SHORT':
      return qtyForm('qtyShort', A != null && E != null ? E - A : null);
    case 'UNORDERED_ITEM':
      return { form: 'unordered', amountAgorot };
    case 'DUPLICATE_INVOICE':
      return { form: 'duplicate', amountAgorot };
    case 'VAT_MISMATCH':
      if (A == null || E == null) return { form: 'other', amountAgorot };
      return { form: A >= E ? 'vat' : 'vatBelow', amountAgorot };
    case 'TOTAL_MISMATCH':
      if (A == null || E == null) return { form: 'other', amountAgorot };
      return { form: A >= E ? 'total' : 'totalBelow', amountAgorot };
    default:
      return { form: 'other', amountAgorot };
  }
}

/** The "what happens next" count: open gaps left after this one. */
export function remainingAfter(summaryCount: number): number {
  return Math.max(0, summaryCount - 1);
}

// ── decisions ─────────────────────────────────────────────────────────────────────────────────

export type BarKind = 'claimPay' | 'duplicate' | 'review' | 'link';

/** From vocab.decisionActions (pinned by vocab.test.ts): kind 'link' → 'link'; a single 'review' → 'review';
 *  DUPLICATE_INVOICE with an approve action → 'duplicate'; else 'claimPay'. */
export function barKindOf(g: { type: string; claimable: boolean }): BarKind {
  const actions = decisionActions(g.type, g.claimable);
  if (actions.some((a) => a.kind === 'link')) return 'link';
  if (actions.length === 1 && actions[0]?.kind === 'review') return 'review';
  if (g.type === 'DUPLICATE_INVOICE' && actions.some((a) => a.kind === 'approve')) return 'duplicate';
  return 'claimPay';
}

export type DecisionBlock = { kind: 'pageQuestion'; invoiceId: string };

/** #190 seam: returns null today. #190 writes: g.pageQuestion && g.invoiceId ? { kind:'pageQuestion', invoiceId } : null. */
export function decisionBlockOf(_g: { invoiceId: string | null }): DecisionBlock | null {
  void _g;
  return null;
}

/** The effect line, claimable rows only: invoiceStatus === 'paid' → 'paid', else 'unpaid'; not claimable → null. */
export function effectOf(g: { claimable: boolean; invoiceStatus?: string | null }): 'unpaid' | 'paid' | null {
  if (!g.claimable) return null;
  return g.invoiceStatus === 'paid' ? 'paid' : 'unpaid';
}
