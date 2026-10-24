import { z } from 'zod';
import { computeLeakBreakdown, computeLeakHero, scanAwaitingCountSql, type LeakBreakdownInvoice } from '@restomatch/charts';
import { eq, restaurants, sql, type Database } from '@restomatch/db';
import { claimableLines, sumClaims, type VatBasis } from '../lib/claims';
import { featureEnabled } from '../lib/features';
import { financeProcedure, router } from '../trpc';

/**
 * Pay run (flag `payRun`): the month's checked invoices that are not marked
 * paid, grouped by supplier, each with one calm status for the person who pays:
 *
 *  • 'pay'   — no open / escalated finding that counts as leak;
 *  • 'hold'  — an open or escalated finding waits for a decision (or the invoice
 *              still waits for its PO link);
 *  • 'claim' — only accepted claims remain: ask the supplier for a credit of the
 *              accepted ₪ (the SAME capped per-invoice rule as the credit letters,
 *              lib/claims.ts).
 *
 * "Not paid" is `invoices.status <> 'paid'` — the app has no payment rail; the
 * UI says "not marked as paid". No new leak math: the month bounds and the
 * per-invoice capped leak come from computeLeakHero / computeLeakBreakdown.
 * Finance roles only (owner / manager / bookkeeper), like the leak drill-down.
 */

export type PayRunStatus = 'pay' | 'hold' | 'claim';

export interface PayRunClaim {
  discrepancyId: string;
  type: string;
  resolutionStatus: string;
  amount: number;
  basis: VatBasis;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
}

export interface PayRunInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  status: PayRunStatus;
  /** The invoice still waits for its PO link (a consolidated invoice): held, calmly. */
  pendingLink: boolean;
  /**
   * A receiving scan waiting for its receipt's count (#94): held until the count
   * is in — bound to its order already, so never "waiting to be linked".
   */
  awaitingCount: boolean;
  /** A (non-waived) duplicate copy: held — "don't pay this copy", never a credit to ask for. */
  duplicate: boolean;
  /** The claimable ₪ of the duplicate finding(s) (= the copy's total incl. VAT); not in pending / credit. */
  duplicateIls: number;
  totalInclVat: number;
  totalExclVat: number;
  /** Open / escalated claimable ₪ (waits for a decision). */
  pendingIls: number;
  /** Accepted claimable ₪ — the credit to ask for. */
  creditIls: number;
  /** Claimable lines (open, escalated, accepted), capped exactly like the letters. */
  claims: PayRunClaim[];
}

export interface PayRunSupplier {
  key: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoices: PayRunInvoice[];
  /** Σ invoice totals incl. VAT per status. */
  payIls: number;
  holdIls: number;
  claimIls: number;
  /** Σ accepted credit ₪ (letters' basis per line, see PayRunClaim.basis). */
  creditIls: number;
  /** Σ open/escalated claimable ₪. */
  pendingIls: number;
  /** Σ totals incl. VAT of invoices waiting for their PO link (T4; not in pay / hold). */
  linkIls: number;
}

export interface PayRunResult {
  enabled: boolean;
  monthStart: string | null;
  monthEnd: string | null;
  suppliers: PayRunSupplier[];
  totals: {
    invoices: number;
    payIls: number;
    holdIls: number;
    claimIls: number;
    creditIls: number;
    pendingIls: number;
    /** Invoices waiting for their PO link (T4), and their totals incl. VAT. */
    linkIls: number;
    linkCount: number;
  };
}

const OPEN = new Set(['open', 'escalated']);
const CLAIMABLE_DUP = new Set(['open', 'escalated', 'accepted']);
const ag = (v: number) => Math.round(v * 100);
const ils = (a: number) => a / 100;
const EMPTY_TOTALS = { invoices: 0, payIls: 0, holdIls: 0, claimIls: 0, creditIls: 0, pendingIls: 0, linkIls: 0, linkCount: 0 };

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** Pure: one invoice's pay-run status from its breakdown entry (null = no finding at all). */
export function payRunStatusOf(b: LeakBreakdownInvoice | null): {
  status: PayRunStatus;
  duplicate: boolean;
  duplicateIls: number;
  claims: PayRunClaim[];
  pendingIls: number;
  creditIls: number;
} {
  if (!b) return { status: 'pay', duplicate: false, duplicateIls: 0, claims: [], pendingIls: 0, creditIls: 0 };
  const lines = claimableLines(b);
  const claims = lines.map(({ line, amount, basis }) => ({
    discrepancyId: line.discrepancyId,
    type: line.type,
    resolutionStatus: line.resolutionStatus,
    amount,
    basis,
    productName: line.productName,
    productNameEn: line.productNameEn,
    lineDescription: line.lineDescription,
    lineDescriptionEn: line.lineDescriptionEn,
  }));
  // An unpaid duplicate copy is not a credit to ask for: the action is "don't pay this copy".
  // Its ₪ (the copy's total incl. VAT) stays out of pending / credit and out of the pay total.
  const isDup = (c: { type: string }) => c.type === 'DUPLICATE_INVOICE';
  const duplicate = b.lines.some((l) => l.countsAsLeak && isDup(l) && CLAIMABLE_DUP.has(l.resolutionStatus));
  const duplicateIls = sumClaims(claims.filter(isDup));
  const rest = claims.filter((c) => !isDup(c));
  const pendingIls = sumClaims(rest.filter((c) => OPEN.has(c.resolutionStatus)));
  const creditIls = sumClaims(rest.filter((c) => c.resolutionStatus === 'accepted'));
  // An open / escalated leak finding holds the invoice, even one whose ₪ the cap already used up —
  // but, like the claimable rule, only a real one: a ₪0 line (the engine's QTY_SHORT "twin" of a
  // billed QTY_OVER) or a non-leak line never keeps an invoice on hold.
  const waiting =
    duplicate ||
    b.pendingLink ||
    b.lines.some((l) => l.countsAsLeak && OPEN.has(l.resolutionStatus) && Math.abs(l.deltaAmount) > 0);
  const status: PayRunStatus = waiting ? 'hold' : creditIls > 0 ? 'claim' : 'pay';
  return { status, duplicate, duplicateIls, claims, pendingIls, creditIls };
}

async function flagOn(db: Database, rid: string): Promise<boolean> {
  const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, rid)).limit(1);
  return featureEnabled(r?.settings ?? {}, 'payRun');
}

export const payRunRouter = router({
  /** Cheap: is the pay run on for the active restaurant (the approvals page links to it)? */
  enabled: financeProcedure.query(async ({ ctx }) => flagOn(ctx.db, ctx.session.restaurantId)),

  month: financeProcedure
    .input(z.object({ monthOffset: z.union([z.literal(0), z.literal(-1)]).default(0) }).optional())
    .query(async ({ ctx, input }): Promise<PayRunResult> => {
      const rid = ctx.session.restaurantId;
      if (!(await flagOn(ctx.db, rid))) {
        return { enabled: false, monthStart: null, monthEnd: null, suppliers: [], totals: EMPTY_TOTALS };
      }
      const monthOffset = input?.monthOffset ?? 0;
      const hero = await computeLeakHero(ctx.db, rid, { monthOffset });
      const breakdown = await computeLeakBreakdown(ctx.db, rid, { monthOffset, limit: 200 });
      const byInvoice = new Map(breakdown.map((b) => [b.invoiceId, b]));

      // The month's invoices not marked paid (matched, or read but waiting for a PO link) — same
      // date rule as the hero.
      const res = await ctx.db.execute(sql`
        SELECT i.id, i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS at,
               COALESCE(i.total_incl_vat, 0) AS total_incl, COALESCE(i.total_excl_vat, 0) AS total_excl,
               i.supplier_id, s.name AS supplier_name, s.name_en AS supplier_name_en,
               -- Safety net for an invoice past the breakdown's 200-row window: any open
               -- warn/block finding still holds it (never shown as payable by omission).
               EXISTS (
                 SELECT 1 FROM match_runs mr2
                 JOIN discrepancies d ON d.match_run_id = mr2.id AND d.restaurant_id = ${rid}
                 WHERE mr2.invoice_id = i.id AND mr2.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status IN ('open','escalated')
                   AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL') AND ABS(d.delta_amount) > 0
               ) AS has_open,
               -- …and accepted real findings still ask for a credit (Σ |Δ|, capped at the
               -- invoice total like the hero's per-invoice cap), never "can pay".
               (
                 SELECT LEAST(COALESCE(SUM(ABS(d.delta_amount)), 0), COALESCE(i.total_incl_vat, 0))
                 FROM match_runs mr3
                 JOIN discrepancies d ON d.match_run_id = mr3.id AND d.restaurant_id = ${rid}
                 WHERE mr3.invoice_id = i.id AND mr3.restaurant_id = ${rid}
                   AND d.severity IN ('warn','block') AND d.resolution_status = 'accepted'
                   AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL','DUPLICATE_INVOICE') AND ABS(d.delta_amount) > 0
               ) AS accepted_ils,
               -- …a non-waived duplicate copy is held ("don't pay this copy"); its ₪ is the copy's total.
               (
                 SELECT LEAST(COALESCE(SUM(ABS(d.delta_amount)), 0), COALESCE(i.total_incl_vat, 0))
                 FROM match_runs mr4
                 JOIN discrepancies d ON d.match_run_id = mr4.id AND d.restaurant_id = ${rid}
                 WHERE mr4.invoice_id = i.id AND mr4.restaurant_id = ${rid}
                   AND d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block')
                   AND d.resolution_status IN ('open','escalated','accepted')
               ) AS dup_ils,
               EXISTS (
                 SELECT 1 FROM match_runs mr5
                 JOIN discrepancies d ON d.match_run_id = mr5.id AND d.restaurant_id = ${rid}
                 WHERE mr5.invoice_id = i.id AND mr5.restaurant_id = ${rid}
                   AND d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block')
                   AND d.resolution_status IN ('open','escalated','accepted')
               ) AS has_dup,
               -- …and an open unordered arrival means the invoice still waits for its PO link.
               EXISTS (
                 SELECT 1 FROM match_runs mr6
                 JOIN discrepancies d ON d.match_run_id = mr6.id AND d.restaurant_id = ${rid}
                 WHERE mr6.invoice_id = i.id AND mr6.restaurant_id = ${rid}
                   AND d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')
               ) AS has_ua,
               EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = i.id AND mr.restaurant_id = ${rid}) AS matched,
               -- …a receiving scan the OCR held for its receipt's count (#94, same rule as the hero).
               ${scanAwaitingCountSql(rid, sql`i`)} AS counting
        FROM invoices i
        LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${rid}
        WHERE i.restaurant_id = ${rid}
          AND i.status <> 'paid'
          AND COALESCE(i.invoice_date, i.created_at) >= ${hero.monthStart}::timestamptz
          AND COALESCE(i.invoice_date, i.created_at) < ${hero.monthEnd}::timestamptz
          -- Checked invoices, plus the read-but-unmatched ones (consolidated invoices waiting
          -- for their PO link, shown as T4 "waiting to be linked"); not invoices still in OCR.
          AND i.status <> 'ocr_pending'
        ORDER BY at DESC, i.invoice_number
      `);

      const groups = new Map<string, PayRunSupplier & { a: Record<string, number> }>();
      for (const row of rowsOf(res)) {
        const id = String(row.id);
        const b = byInvoice.get(id) ?? null;
        const s = payRunStatusOf(b);
        // Past the breakdown's 200-row window (known limit, not reached by the demo): an open
        // real finding still holds the invoice; an unmatched one waits for its link.
        if (!b && row.has_open === true) s.status = 'hold';
        if (!b && Number(row.accepted_ils ?? 0) > 0) {
          s.creditIls = Math.round(Number(row.accepted_ils) * 100) / 100;
          if (s.status === 'pay') s.status = 'claim';
        }
        if (!b && row.has_dup === true) {
          s.duplicate = true;
          s.duplicateIls = Math.round(Number(row.dup_ils ?? 0) * 100) / 100;
          s.status = 'hold';
        }
        // Waiting for the count (#94): no run yet, but bound to its order — held, not T4.
        const awaitingCount = row.matched !== true && row.counting === true;
        const pendingLink =
          !awaitingCount && ((b?.pendingLink ?? false) || row.matched !== true || (!b && row.has_ua === true));
        if (pendingLink || awaitingCount) s.status = 'hold';
        const inv: PayRunInvoice = {
          invoiceId: id,
          invoiceNumber: row.invoice_number == null ? null : String(row.invoice_number),
          invoiceDate: iso(row.at),
          status: s.status,
          pendingLink,
          awaitingCount,
          duplicate: s.duplicate,
          duplicateIls: s.duplicateIls,
          totalInclVat: Number(row.total_incl),
          totalExclVat: Number(row.total_excl),
          pendingIls: s.pendingIls,
          creditIls: s.creditIls,
          claims: s.claims,
        };
        const key = row.supplier_id == null ? '' : String(row.supplier_id);
        let g = groups.get(key);
        if (!g) {
          g = {
            key,
            supplierName: row.supplier_name == null ? null : String(row.supplier_name),
            supplierNameEn: row.supplier_name_en == null ? null : String(row.supplier_name_en),
            invoices: [],
            payIls: 0,
            holdIls: 0,
            claimIls: 0,
            creditIls: 0,
            pendingIls: 0,
            linkIls: 0,
            a: { pay: 0, hold: 0, claim: 0, credit: 0, pending: 0, link: 0 },
          };
          groups.set(key, g);
        }
        g.invoices.push(inv);
        // Waiting for a PO link is T4: its total is reported on its own, never as pay or hold ₪.
        if (inv.pendingLink && !inv.duplicate) g.a.link! += ag(inv.totalInclVat);
        else g.a[inv.status]! += ag(inv.totalInclVat);
        g.a.credit! += ag(inv.creditIls);
        g.a.pending! += ag(inv.pendingIls);
      }

      const t = { pay: 0, hold: 0, claim: 0, credit: 0, pending: 0, link: 0, invoices: 0, linkCount: 0 };
      const suppliers: PayRunSupplier[] = [...groups.values()].map(({ a, ...g }) => {
        for (const k of ['pay', 'hold', 'claim', 'credit', 'pending', 'link'] as const) t[k] += a[k]!;
        t.invoices += g.invoices.length;
        t.linkCount += g.invoices.filter((i) => i.pendingLink && !i.duplicate).length;
        return {
          ...g,
          payIls: ils(a.pay!),
          holdIls: ils(a.hold!),
          claimIls: ils(a.claim!),
          creditIls: ils(a.credit!),
          pendingIls: ils(a.pending!),
          linkIls: ils(a.link!),
        };
      });
      // Suppliers needing action first (held ₪, then credits), then the payable ones.
      suppliers.sort(
        (x, y) =>
          y.holdIls - x.holdIls ||
          y.creditIls - x.creditIls ||
          y.payIls - x.payIls ||
          (x.supplierName ?? '').localeCompare(y.supplierName ?? '', 'he'),
      );
      return {
        enabled: true,
        monthStart: hero.monthStart,
        monthEnd: hero.monthEnd,
        suppliers,
        totals: {
          invoices: t.invoices,
          payIls: ils(t.pay),
          holdIls: ils(t.hold),
          claimIls: ils(t.claim),
          creditIls: ils(t.credit),
          pendingIls: ils(t.pending),
          linkIls: ils(t.link),
          linkCount: t.linkCount,
        },
      };
    }),
});
