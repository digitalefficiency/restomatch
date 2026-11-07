import { z } from 'zod';
import { eq, restaurants, sql, type Database } from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { zonedMidnight } from '../ledger/months';
import { deliveryNoteCoverage } from '../match/consolidated';
import { financeProcedure, router } from '../trpc';

/**
 * Month close checklist (W3-05a).
 *
 * Only the figures that have NO home elsewhere are computed here (the owner's
 * one-home-per-number rule). The close page reads the others from their own
 * procedures: gaps awaiting decision = `approvals.queueSummary`, unsent claims
 * = recovery `followUps()`, VAT at risk = `owner.vatAtRisk`. Read-only.
 *
 * Every query is scoped by `restaurant_id` (DoD-8; COVERAGE `close.checklist`).
 */

const DEFAULT_TZ = 'Asia/Jerusalem';
/** An invoice still waiting for its check (OCR not done, or parsed and never matched). */
const UNCHECKED = ['ocr_pending', 'parsed'] as const;
/** A consolidated invoice past review covers its notes; before that it is pending (T4). */
const SETTLED = ['matched', 'approved', 'paid'] as const;

export interface CloseFigure {
  count: number;
  /** ₪, agora-exact (from integer agorot). */
  amountIls: number;
}

export interface CloseChecklist {
  /** 'YYYY-MM' on the restaurant's wall clock. */
  month: string;
  timezone: string;
  /** Invoices of the month not yet checked (consolidated ones excluded: they are step 4). Incl. VAT. */
  unchecked: CloseFigure;
  /** Consolidated invoices (חשבוניות ריכוז) of the month not yet settled. Incl. VAT. Always T4. */
  consolidated: CloseFigure & { firstInvoiceId: string | null };
  /** Delivery notes received in the month that no invoice covers (before VAT); null when the ledger flag is off. */
  deliveryNotes: CloseFigure | null;
}

async function settingsOf(db: Database, restaurantId: string) {
  const [r] = await db
    .select({ tz: restaurants.timezone, settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return { tz: r?.tz ?? DEFAULT_TZ, settings: r?.settings };
}

/** [start, end) of 'YYYY-MM' on the wall clock of `tz`. */
export function monthWindow(month: string, tz: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  return { start: zonedMidnight(y, m, 1, tz), end: zonedMidnight(next[0]!, next[1]!, 1, tz) };
}

/** NULL-safe: an ordinary invoice has no `kind`, and NOT NULL would drop it from both steps. */
const isConsolidated = sql`COALESCE((ocr_payload->'raw'->>'kind') = 'consolidated', false)`;
const inList = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

async function invoiceFigures(db: Database, restaurantId: string, start: Date, end: Date) {
  const rows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE NOT ${isConsolidated} AND status::text IN (${inList(UNCHECKED)}))::int AS unchecked_count,
      COALESCE(sum(round(COALESCE(total_incl_vat, 0) * 100))
        FILTER (WHERE NOT ${isConsolidated} AND status::text IN (${inList(UNCHECKED)})), 0)::bigint AS unchecked_agorot,
      count(*) FILTER (WHERE ${isConsolidated} AND status::text NOT IN (${inList(SETTLED)}))::int AS cons_count,
      COALESCE(sum(round(COALESCE(total_incl_vat, 0) * 100))
        FILTER (WHERE ${isConsolidated} AND status::text NOT IN (${inList(SETTLED)})), 0)::bigint AS cons_agorot,
      (array_agg(id ORDER BY COALESCE(invoice_date, created_at), id)
        FILTER (WHERE ${isConsolidated} AND status::text NOT IN (${inList(SETTLED)})))[1] AS cons_first
    FROM invoices
    WHERE restaurant_id = ${restaurantId}::uuid
      AND COALESCE(invoice_date, created_at) >= ${start.toISOString()}::timestamptz
      AND COALESCE(invoice_date, created_at) < ${end.toISOString()}::timestamptz
  `)) as unknown as Array<{
    unchecked_count: number;
    unchecked_agorot: string | number;
    cons_count: number;
    cons_agorot: string | number;
    cons_first: string | null;
  }>;
  const r = rows[0];
  return {
    unchecked: { count: Number(r?.unchecked_count ?? 0), amountIls: Number(r?.unchecked_agorot ?? 0) / 100 },
    consolidated: {
      count: Number(r?.cons_count ?? 0),
      amountIls: Number(r?.cons_agorot ?? 0) / 100,
      firstInvoiceId: r?.cons_first ?? null,
    },
  };
}

/** Reuses the ledger's `deliveryNoteCoverage` for each supplier with notes in the month — no second rule set. */
async function uncoveredNotes(db: Database, restaurantId: string, start: Date, end: Date): Promise<CloseFigure> {
  const suppliers = (await db.execute(sql`
    SELECT DISTINCT po.supplier_id AS id
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.po_id AND po.restaurant_id = ${restaurantId}::uuid
    WHERE gr.restaurant_id = ${restaurantId}::uuid
      AND gr.received_at >= ${start.toISOString()}::timestamptz
      AND gr.received_at < ${end.toISOString()}::timestamptz
      AND po.supplier_id IS NOT NULL
  `)) as unknown as Array<{ id: string }>;
  let count = 0;
  let agorot = 0;
  for (const s of suppliers) {
    for (const n of await deliveryNoteCoverage(db, restaurantId, s.id, start, end)) {
      if (n.state !== 'not_invoiced') continue;
      count += 1;
      agorot += Math.round(n.receivedValueIls * 100);
    }
  }
  return { count, amountIls: agorot / 100 };
}

export const closeRouter = router({
  /** The month's close figures that live nowhere else. Owner, manager (read), bookkeeper. */
  checklist: financeProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
    .query(async ({ ctx, input }): Promise<CloseChecklist> => {
      const rid = ctx.session.restaurantId;
      const { tz, settings } = await settingsOf(ctx.db, rid);
      const { start, end } = monthWindow(input.month, tz);
      const [inv, notes] = await Promise.all([
        invoiceFigures(ctx.db, rid, start, end),
        featureEnabled(settings, 'supplierLedger') ? uncoveredNotes(ctx.db, rid, start, end) : Promise.resolve(null),
      ]);
      return { month: input.month, timezone: tz, ...inv, deliveryNotes: notes };
    }),
});
