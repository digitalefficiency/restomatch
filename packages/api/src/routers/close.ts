import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, eq, inArray, invoices, restaurants, sql, type Database } from '@restomatch/db';
import { invoiceStatesForMonth } from '../invoices/state';
import { featureEnabled } from '../lib/features';
import { zonedMidnight } from '../ledger/months';
import { deliveryNoteCoverage, readConsolidatedRaw } from '../match/consolidated';
import { financeProcedure, router } from '../trpc';
import { tabOfState } from './invoices';

/**
 * Month close checklist (W3-05a).
 *
 * Only the figures that have NO home elsewhere are computed here (the owner's
 * one-home-per-number rule). The close page reads the others from their own
 * procedures: gaps awaiting decision = `approvals.queueSummary`, unsent claims
 * = recovery `followUps()`, VAT at risk = `owner.vatAtRisk`. Read-only.
 *
 * Invoice steps read the W2-02 register's own partition (G-05 canonical state →
 * `tabOfState`): "unchecked" = the register's `awaiting` tab (in OCR, or no match
 * run yet) WITHOUT consolidated invoices, which are step 4 (T4 pending, never a
 * T2 alarm, and never the same ₪ twice). The register's awaiting tab therefore
 * shows step 1 + step 4's awaiting rows (asserted in close.test).
 *
 * Every query is scoped by `restaurant_id` (DoD-8; COVERAGE `close.checklist`).
 */

const DEFAULT_TZ = 'Asia/Jerusalem';
/** The register's month offset limit (`invoices.list` accepts -24..0). */
const MAX_BACK = 24;

export interface CloseFigure {
  count: number;
  /** ₪, agora-exact (from integer agorot). */
  amountIls: number;
}

export interface CloseChecklist {
  /** 'YYYY-MM' on the restaurant's wall clock. */
  month: string;
  timezone: string;
  /** The register's `?month=` for this month (0 = current, -1 = previous, …). */
  monthOffset: number;
  /** The register's `awaiting` tab for the month minus consolidated invoices (step 4). Incl. VAT. */
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

/** Register month offset of 'YYYY-MM' against `now` on the wall clock of `tz` (unclamped: 0 = current, -1 = previous). */
export function monthOffsetOf(month: string, tz: string, now = new Date()): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  return y * 12 + m - (Number(p.year) * 12 + Number(p.month));
}

async function invoiceFigures(db: Database, restaurantId: string, monthOffset: number, now: Date) {
  const states = await invoiceStatesForMonth(db, restaurantId, { monthOffset, now });
  const agorot = (ils: number) => Math.round(ils * 100);
  // Consolidated (חשבונית מרכזת) and not yet in the register's matched/paid tabs → pending (T4).
  const open = states.filter((s) => tabOfState(s.state) !== 'matched' && tabOfState(s.state) !== 'paid');
  const payloads = open.length
    ? await db
        .select({ id: invoices.id, payload: invoices.ocrPayload, at: sql<string>`COALESCE(${invoices.invoiceDate}, ${invoices.createdAt})` })
        .from(invoices)
        .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, open.map((s) => s.invoiceId))))
    : [];
  const consolidatedIds = payloads
    .filter((r) => readConsolidatedRaw(r.payload) !== null)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id))
    .map((r) => r.id);
  const consSet = new Set(consolidatedIds);
  const cons = open.filter((s) => consSet.has(s.invoiceId));
  const unchecked = states.filter((s) => tabOfState(s.state) === 'awaiting' && !consSet.has(s.invoiceId));
  return {
    unchecked: {
      count: unchecked.length,
      amountIls: unchecked.reduce((t, s) => t + agorot(s.totalInclVat), 0) / 100,
    },
    consolidated: {
      count: cons.length,
      amountIls: cons.reduce((t, s) => t + agorot(s.totalInclVat), 0) / 100,
      firstInvoiceId: consolidatedIds[0] ?? null,
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
      const now = new Date();
      const monthOffset = monthOffsetOf(input.month, tz, now);
      // Never return another month's ₪ under the requested label: out of the register's range is an error.
      if (monthOffset > 0 || monthOffset < -MAX_BACK) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `month out of range (last ${MAX_BACK} months, no future)` });
      }
      const [inv, notes] = await Promise.all([
        invoiceFigures(ctx.db, rid, monthOffset, now),
        featureEnabled(settings, 'supplierLedger') ? uncoveredNotes(ctx.db, rid, start, end) : Promise.resolve(null),
      ]);
      return { month: input.month, timezone: tz, monthOffset, ...inv, deliveryNotes: notes };
    }),
});
