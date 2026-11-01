import { z } from 'zod';
import { activityEvents, and, desc, eq, lt, type UserRole } from '@restomatch/db';
import { NO_MONEY_ROLES, hasShekel, stripShekelFigures } from '../lib/staffMoney';
import { memberProcedure, router } from '../trpc';

/**
 * PILOT (train B): receiver and chef see no ₪ in the activity feed (owner rule:
 * the receiver never sees ₪; the chef sees ₪ only on orders and recipes). This
 * is the data-tier backstop: their homes don't mount the feed, but tRPC is
 * callable directly. Superseded by G-07 (#182), which keeps these names.
 */
export { NO_MONEY_ROLES };

/** Event kinds whose `detail` carries purchase / leak ₪. */
export const MONEY_BEARING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'invoice_matched',
  'discrepancy_approved',
  'discrepancy_rejected',
]);

/** Metadata keys that carry ₪ (potentialLossIls, leakIls, savingsIls, amountIls, …). */
export const MONEY_METADATA_KEY = /(Ils|Agorot)$|amount|savings|total|price/i;

/**
 * The ONLY metadata keys a receiver / chef receives: the money-free keys the
 * writers produce (match/persist.ts, approvals approve/reject, the demo seeds).
 * Everything else is dropped, including free text such as `reason` ("הספק חייב
 * 45 שקל"), so a new money key or a new free-text field can't leak by default.
 */
export const STAFF_METADATA_KEYS: ReadonlySet<string> = new Set([
  'invoiceId',
  'invoiceNumber',
  'supplierName',
  'supplierNameEn',
  'discrepancyId',
  'discrepancyType',
  'discrepancyCount',
  'leakCount',
  'reviewCount',
  'pendingLink',
  'poMatched',
  'status',
  'duplicateKey',
  'reasonCode',
  'role',
  'consolidated',
  'kind',
  'v',
  'rows',
  'count',
]);

function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (!STAFF_METADATA_KEYS.has(k) || MONEY_METADATA_KEY.test(k)) continue;
    // Primitives only: a nested object or array could carry anything.
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && !hasShekel(v)) out[k] = v;
  }
  return out;
}

interface FeedRow {
  id: string;
  eventType: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Receiver / chef: `detail` is always null (legacy v1 rows put ₪ in the free
 * text, which the web's legacy parser re-renders), metadata keeps only the
 * allow-listed money-free keys, and ₪ figures (₪, ש"ח, ש״ח, ש”ח, ש''ח, שח, שקל,
 * ILS, NIS, with the adjacent digits) are cut from the title. Owner, manager
 * and bookkeeper get the row untouched (same reference).
 */
export function redactActivityForRole<T extends FeedRow>(role: UserRole, row: T): T {
  if (!NO_MONEY_ROLES.has(role)) return row;
  return {
    ...row,
    title: hasShekel(row.title) ? stripShekelFigures(row.title) : row.title,
    detail: null,
    metadata: redactMetadata(row.metadata),
  };
}

export const activityRouter = router({
  /**
   * Recent activity timeline for the current restaurant.
   *
   * NON-BREAKING pagination: still returns the SAME ARRAY (desc by createdAt).
   * When `cursor` (an ISO timestamp) is supplied, only rows strictly older than
   * it are returned — pass the createdAt of the last row of the previous page to
   * load the next page.
   *
   * Receiver / chef get ₪-free rows (redactActivityForRole); same shape.
   */
  feed: memberProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(50).default(20),
          cursor: z.string().datetime().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const cursorDate = input?.cursor ? new Date(input.cursor) : null;
      const rows = await ctx.db
        .select({
          id: activityEvents.id,
          eventType: activityEvents.eventType,
          title: activityEvents.title,
          detail: activityEvents.detail,
          // Structured fields (invoice number, supplier, counts, ₪) so the UI can
          // render the entry in any locale instead of parsing the Hebrew text.
          metadata: activityEvents.metadata,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.restaurantId, ctx.session.restaurantId),
            cursorDate ? lt(activityEvents.createdAt, cursorDate) : undefined,
          ),
        )
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);
      if (!NO_MONEY_ROLES.has(ctx.session.role)) return rows;
      return rows.map((row) => redactActivityForRole(ctx.session.role, row));
    }),
});
