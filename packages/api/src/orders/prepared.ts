import type { ExpectedPriceSource } from './expectedPrice';

/**
 * W3-09 / AU-11 a · Prepared order draft: the pure core.
 *
 * On an order day a draft built from the order guide (W2-06) is waiting for the
 * chef or manager. It is shown, never sent: nothing here places an order or
 * enqueues an outbox row. The idempotent insert lives in `autopilot.ts`
 * (advisory lock on `<rid>:<source_ref>` + select-by-source_ref, the
 * `captureOrderDraft` pattern — the unique index includes `source_platform`,
 * which is NULL for these drafts, so it never dedupes on its own).
 *
 * Prices come ONLY from the injected expected-price resolver (W2-06's
 * `resolveExpectedPrice`: contract > own last explicit price > list). The
 * invoice price is never a source (owner decision 21).
 */

export const PREPARED_MAX_LINES = 40;
export const PREPARED_MIN_GUIDE_ROWS = 2;
export const PREPARED_NOTE = 'טיוטה מוכנה לפי מדריך ההזמנה';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function preparedSourceRef(supplierId: string, orderDay: string): string {
  if (!DAY_RE.test(orderDay)) throw new Error(`orderDay must be YYYY-MM-DD, got ${orderDay}`);
  return `au:A16:${supplierId}:${orderDay}`;
}

export function backorderSourceRef(goodsReceiptId: string): string {
  return `au:A16b:${goodsReceiptId}`;
}

export function isPreparedSourceRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith('au:A16:');
}

export function isBackorderSourceRef(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith('au:A16b:');
}

/** A draft the autopilot prepared (prepared or backorder), adoptable by the first orderer. */
export function isAutopilotSourceRef(ref: string | null | undefined): boolean {
  return isPreparedSourceRef(ref) || isBackorderSourceRef(ref);
}

/** SQL LIKE patterns for the two autopilot refs (never the W1-11 capture refs). */
export const AUTOPILOT_REF_LIKES = ['au:A16:%', 'au:A16b:%'] as const;

/** A guide row (structural: W2-06's `orderGuide` row narrowed to what we need). */
export interface GuideRow {
  productId: string | null;
  description: string;
  unit: string;
  /** Median of the last 4 orders; null = no usual quantity → not prepared. */
  usualQty: number | null;
  /** Higher = ordered more often; used to keep the top 40. */
  frequency: number;
}

export interface ExpectedPrice {
  unitPrice: number | null;
  source: ExpectedPriceSource | null;
}

export type ExpectedPriceResolver = (row: GuideRow) => ExpectedPrice;

export interface PreparedLine {
  productId: string | null;
  rawDescription: string;
  unit: string;
  qty: number;
  unitPriceExpected: number | null;
  priceSource: ExpectedPrice['source'];
}

export interface PreparedContext {
  supplierActive: boolean;
  /** A non-cancelled PO for this supplier created on the order day. */
  hasPoToday: boolean;
  /** An open draft owned by a person (created_by NOT NULL). */
  hasOpenHumanDraft: boolean;
}

export type PreparedSkip = 'inactive' | 'po_today' | 'human_draft' | 'thin_guide';

export function preparedSkipReason(ctx: PreparedContext, rows: readonly GuideRow[]): PreparedSkip | null {
  if (!ctx.supplierActive) return 'inactive';
  if (ctx.hasPoToday) return 'po_today';
  if (ctx.hasOpenHumanDraft) return 'human_draft';
  if (usable(rows).length < PREPARED_MIN_GUIDE_ROWS) return 'thin_guide';
  return null;
}

function usable(rows: readonly GuideRow[]): GuideRow[] {
  return rows.filter((r) => r.usualQty !== null && Number.isFinite(r.usualQty) && r.usualQty > 0);
}

/** Top-40 guide rows with a usual quantity, priced by the resolver only. */
export function buildPreparedLines(rows: readonly GuideRow[], priceOf: ExpectedPriceResolver): PreparedLine[] {
  return usable(rows)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.frequency - a.r.frequency || a.i - b.i)
    .slice(0, PREPARED_MAX_LINES)
    .map(({ r }) => {
      const p = priceOf(r);
      const price = p.unitPrice !== null && Number.isFinite(p.unitPrice) && p.unitPrice > 0 ? p.unitPrice : null;
      return {
        productId: r.productId,
        rawDescription: r.description,
        unit: r.unit,
        qty: r.usualQty!,
        unitPriceExpected: price,
        priceSource: price === null ? null : p.source,
      };
    });
}
