import { z } from 'zod';
import { activityEvents, and, desc, eq, lt, type UserRole } from '@restomatch/db';
import { hasCap } from '../lib/capabilities';
import { memberProcedure, router } from '../trpc';

/**
 * Event kinds whose `detail` carries purchase / leak ₪ (match/persist.ts
 * invoice_matched; approvals approve → formatted ₪, reject → free-text reason).
 */
export const MONEY_BEARING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'invoice_matched',
  'discrepancy_approved',
  'discrepancy_rejected',
]);

/** Metadata keys that carry ₪ (potentialLossIls, leakIls, savingsIls, amountIls, …). */
export const MONEY_METADATA_KEY = /(Ils|Agorot)$|amount|savings|total|price/i;

const SHEKEL = '₪';
/** A ₪ figure in either order ("₪1,234.50", "1,234.50 ₪"), incl. bidi marks + a sign. */
const SHEKEL_FIGURE = /[‎‏⁦-⁩]*[-−+]?\s*₪\s*[-−]?[\d.,]+|[-−]?[\d.,]+\s*₪/g;

function stripShekelFigures(text: string): string {
  return text.replace(SHEKEL_FIGURE, '').replaceAll(SHEKEL, '').replace(/\s{2,}/g, ' ').trim();
}

function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => !(typeof v === 'string' && v.includes(SHEKEL))).map(redactMetadata);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_METADATA_KEY.test(k)) continue;
      if (typeof v === 'string' && v.includes(SHEKEL)) continue;
      out[k] = redactMetadata(v);
    }
    return out;
  }
  return value;
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
 * G-07 (ia-nav-01, data tier — interim before H-11): roles without
 * `money.view` (receiver, chef) get the feed with no ₪: `detail` nulled for
 * money-bearing kinds (and wherever it carries ₪), ₪ metadata keys dropped,
 * and no string containing ₪ left in the row. Roles with `money.view` get the
 * row untouched (same reference).
 */
export function redactActivityForRole<T extends FeedRow>(role: UserRole, row: T): T {
  if (hasCap(role, 'money.view')) return row;
  const detail =
    row.detail == null || MONEY_BEARING_EVENT_TYPES.has(row.eventType) || row.detail.includes(SHEKEL)
      ? null
      : row.detail;
  return {
    ...row,
    title: row.title.includes(SHEKEL) ? stripShekelFigures(row.title) : row.title,
    detail,
    metadata: redactMetadata(row.metadata ?? {}) as Record<string, unknown>,
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
   * Receiver / chef (no `money.view`) get ₪-free rows: redactActivityForRole.
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
      if (hasCap(ctx.session.role, 'money.view')) return rows;
      return rows.map((row) => redactActivityForRole(ctx.session.role, row));
    }),
});
