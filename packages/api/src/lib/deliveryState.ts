import { sql } from '@restomatch/db';
import { localDateKeyInTz } from './time';

/**
 * Where a purchase order stands on delivery — ONE definition for the late-
 * delivery e-mail (supplier-delays), the morning expectations list
 * (daily-expectations) and any board that shows deliveries.
 *
 * The truth comes from the PO's latest goods receipt, not from
 * purchase_orders.status: receiving never moves a PO out of 'sent' (and must
 * not — the matcher discovers sent/confirmed/partial POs, so an invoice arriving
 * after the delivery still finds its order). Reading only the PO status is what
 * made the daily "late delivery" e-mail go out for POs already received (G-01).
 */
export type DeliveryState = 'upcoming' | 'due_today' | 'late' | 'in_progress' | 'received' | 'cancelled';

export type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
export type ReceiptStatus = 'pending' | 'partial' | 'completed' | 'rejected';

/** A PO is late once this long past its expected delivery time with no goods receipt. */
export const LATE_GRACE_MS = 60 * 60_000;

export interface DeliveryStateInput {
  po: { status: PoStatus; expectedDeliveryAt: Date | null };
  /** The PO's most recent goods receipt (latestReceiptStatusSql), or null when none exists. */
  latestReceipt: { status: ReceiptStatus } | null;
  now: Date;
  /** The restaurant's IANA zone — "today" is its local calendar day. */
  tz: string;
}

/**
 * Pure. Order of precedence:
 *  1. cancelled PO → cancelled; closed PO (incl. a platform sync) → received.
 *  2. Any goods receipt decides it: pending → in_progress; completed / partial /
 *     rejected → received. A partial receipt is terminal for the board — the
 *     missing lines are a backorder, i.e. a new PO — and a rejected one was a
 *     delivery that came (and was turned away), not one that never arrived.
 *  3. No receipt: late once now ≥ expected + 60 min; due_today when the expected
 *     time is on (or before) today's local date; otherwise upcoming. No expected
 *     time → upcoming (nothing to be late against).
 */
export function deliveryState({ po, latestReceipt, now, tz }: DeliveryStateInput): DeliveryState {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'closed') return 'received';
  if (latestReceipt) return latestReceipt.status === 'pending' ? 'in_progress' : 'received';
  const expected = po.expectedDeliveryAt;
  if (!expected) return 'upcoming';
  if (now.getTime() >= expected.getTime() + LATE_GRACE_MS) return 'late';
  return localDateKeyInTz(expected, tz) <= localDateKeyInTz(now, tz) ? 'due_today' : 'upcoming';
}

/** Whole local calendar days from `from` to `to` in `tz` (DST-safe: compares dates, not hours). */
export function localDaysBetween(from: Date, to: Date, tz: string): number {
  const day = (d: Date) => {
    const [y, m, dd] = localDateKeyInTz(d, tz).split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, dd) / 86_400_000;
  };
  return day(to) - day(from);
}

/**
 * The status of the PO's latest goods receipt, as a correlated subquery on
 * "purchase_orders" (null when it has none). The outer column is spelled out:
 * Drizzle leaves `${purchaseOrders.id}` unqualified in a single-table select,
 * where it would bind to g.id.
 */
export function latestReceiptStatusSql(restaurantId: string) {
  return sql<ReceiptStatus | null>`(
    SELECT g.status::text FROM goods_receipts g
    WHERE g.po_id = "purchase_orders"."id" AND g.restaurant_id = ${restaurantId}
    ORDER BY g.received_at DESC, g.created_at DESC LIMIT 1
  )`;
}

/**
 * deliveryState() as a SQL expression on "purchase_orders" — the same rules, for
 * filtering / grouping in the database. `now` and `tz` default to the database
 * clock and Asia/Jerusalem; pass them to pin a test or a job's "today".
 */
export function poDeliveryStateSql(restaurantId: string, opts: { now?: Date; tz?: string } = {}) {
  const tz = opts.tz ?? 'Asia/Jerusalem';
  const now = opts.now ? sql`${opts.now.toISOString()}::timestamptz` : sql`now()`;
  const receipt = latestReceiptStatusSql(restaurantId);
  return sql<DeliveryState>`(CASE
    WHEN "purchase_orders"."status" = 'cancelled' THEN 'cancelled'
    WHEN "purchase_orders"."status" = 'closed' THEN 'received'
    WHEN ${receipt} = 'pending' THEN 'in_progress'
    WHEN ${receipt} IS NOT NULL THEN 'received'
    WHEN "purchase_orders"."expected_delivery_at" IS NULL THEN 'upcoming'
    WHEN ${now} >= "purchase_orders"."expected_delivery_at" + interval '60 minutes' THEN 'late'
    WHEN ("purchase_orders"."expected_delivery_at" AT TIME ZONE ${tz})::date <= (${now} AT TIME ZONE ${tz})::date THEN 'due_today'
    ELSE 'upcoming'
  END)`;
}
