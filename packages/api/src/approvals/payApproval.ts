/**
 * G-15b: the pay-approval gate W2-03's `approve_for_payment` calls.
 *
 * The rule itself is the pure `evaluatePayApproval` (approvals/engine.ts,
 * immutable). This module only gathers its inputs for ONE invoice, scoped to
 * the caller's restaurant:
 *   • the invoice total incl. VAT (owner 11.11, Q2);
 *   • the supplier's PRIOR invoices that were PAID, excluding duplicate copies
 *     (owner 11.11, Q4: "only previously paid invoices, no duplicates");
 *   • the restaurant's thresholds from settings.approvalThresholds (read-only
 *     via resolvePayApprovalThresholds; default ₪5,000 and above / first invoice).
 *
 * `assertCanApproveForPayment` throws FORBIDDEN `payment.ownerApprovalRequired`
 * (params: reasons, amount, threshold) when the rule says owner-only and the
 * caller is not the owner. It never writes.
 */
import { and, eq, invoices, ne, restaurants, sql, type Database, type UserRole } from '@restomatch/db';
import { TRPCError } from '@trpc/server';
import { appError } from '../errors';
import { evaluatePayApproval, resolvePayApprovalThresholds, type PayApprovalDecision } from './engine';

export interface PayApprovalInputs {
  /**
   * The amount the rule compares (₪ incl. VAT): the HIGHEST known of the header total, the
   * document total the OCR read (`ocr_payload.raw.reconciled.totals.total`, which no header edit
   * rewrites) and Σ lines incl. VAT. A non-owner can't lower it by editing the header alone.
   * 0 when nothing is known; then `amountKnown` is false and the rule fails closed (owner).
   * Unknown also when there is no OCR document total and a non-owner ever changed the figures.
   */
  totalInclVat: number;
  amountKnown: boolean;
  supplierPriorInvoices: number;
  thresholds: ReturnType<typeof resolvePayApprovalThresholds>;
}

/**
 * Count the supplier's earlier PAID invoices at this restaurant, never the
 * invoice itself, and never a live duplicate copy (a DUPLICATE_INVOICE finding
 * that was not rejected as "not a duplicate").
 */
async function priorPaidInvoices(
  db: Database,
  restaurantId: string,
  supplierId: string,
  invoiceId: string,
): Promise<number> {
  const [row] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.supplierId, supplierId),
        eq(invoices.status, 'paid'),
        ne(invoices.id, invoiceId),
        sql`NOT EXISTS (
          SELECT 1 FROM discrepancies d
          JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
          WHERE mr.invoice_id = ${invoices.id}
            AND d.restaurant_id = ${restaurantId}
            AND d.type = 'DUPLICATE_INVOICE'
            AND d.resolution_status <> 'rejected'
        )`,
      ),
    )) as [{ n: number }];
  return row?.n ?? 0;
}

/** Load the rule's inputs for one invoice of the caller's restaurant (null: not found here). */
export async function loadPayApprovalInputs(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<PayApprovalInputs | null> {
  const [inv] = await db
    .select({
      total: invoices.totalInclVat,
      supplierId: invoices.supplierId,
      // The OCR's own read of the document total (numbers only; anything else is unknown).
      ocrTotal: sql<string | null>`CASE WHEN jsonb_typeof(${invoices.ocrPayload}->'raw'->'reconciled'->'totals'->'total') = 'number'
        THEN (${invoices.ocrPayload}->'raw'->'reconciled'->'totals'->>'total') END`,
      // Σ lines incl. VAT at the rate our own header uses (receiving recomputeInvoiceTotals →
      // firstVatRate): the line's, else the invoice's PO (latest match run), else the
      // supplier's, else the restaurant's. Tenant-scoped through the invoice row. NULL: no lines.
      linesTotal: sql<string | null>`(SELECT sum(l.line_total * (1 + coalesce(
            l.vat_rate,
            (SELECT po.vat_rate FROM match_runs mr
               JOIN purchase_orders po ON po.id = mr.po_id AND po.restaurant_id = "invoices"."restaurant_id"
              WHERE mr.invoice_id = "invoices"."id" AND mr.restaurant_id = "invoices"."restaurant_id"
              ORDER BY mr.run_at DESC LIMIT 1),
            (SELECT sp.vat_rate FROM suppliers sp
              WHERE sp.id = "invoices"."supplier_id" AND sp.restaurant_id = "invoices"."restaurant_id"),
            r.vat_rate)))::numeric(14,2)::text
        FROM invoice_lines l JOIN restaurants r ON r.id = "invoices"."restaurant_id"
        WHERE l.invoice_id = "invoices"."id")`,
      // With no OCR document total there is nothing a header / line edit can't rewrite (a
      // retake wipes raw.reconciled too): did anyone but an owner of this restaurant ever
      // change the invoice's figures? (append-only audit_log; a deleted user counts as non-owner)
      editedByNonOwner: sql<boolean>`EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.restaurant_id = "invoices"."restaurant_id"
          AND (
            (a.entity_type = 'invoice' AND a.entity_id = "invoices"."id"
              AND a.action IN ('receiving.invoice_header_updated', 'receiving.invoice_retaken'))
            OR (a.entity_type = 'invoice_line'
              AND a.action IN ('receiving.invoice_line_added', 'receiving.invoice_line_updated', 'receiving.invoice_line_deleted')
              AND ((a.before ->> 'invoiceId') = "invoices"."id"::text OR (a.after ->> 'invoiceId') = "invoices"."id"::text))
          )
          AND NOT EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.user_id = a.user_id AND m.restaurant_id = a.restaurant_id AND m.role = 'owner'
          )
      )`,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv) return null;
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const thresholds = resolvePayApprovalThresholds(
    (r?.settings?.approvalThresholds ?? null) as Record<string, unknown> | null,
  );
  // An invoice with no supplier yet has no history: it counts as a new supplier.
  const supplierPriorInvoices = inv.supplierId
    ? await priorPaidInvoices(db, restaurantId, inv.supplierId, invoiceId)
    : 0;
  const num = (v: string | null) => (v == null ? NaN : Number(v));
  const header = num(inv.total);
  const ocr = num(inv.ocrTotal);
  const lines = num(inv.linesTotal);
  // Known only from a header or the OCR's document total; Σ lines may RAISE the figure, never be
  // its only basis (a partial / ₪0.00 read). With no OCR total, figures a non-owner changed are
  // not trusted at all (review of #380: header, lines and a retake are all non-owner-editable).
  const amountKnown =
    (Number.isFinite(header) || Number.isFinite(ocr)) && (Number.isFinite(ocr) || !inv.editedByNonOwner);
  const known = [header, ocr, lines].filter((n) => Number.isFinite(n));
  return { totalInclVat: amountKnown ? Math.max(...known) : 0, amountKnown, supplierPriorInvoices, thresholds };
}

/** The rule's decision for one invoice (null: invoice not found in this restaurant). */
export async function payApprovalFor(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<(PayApprovalDecision & { inputs: PayApprovalInputs }) | null> {
  const inputs = await loadPayApprovalInputs(db, restaurantId, invoiceId);
  if (!inputs) return null;
  return {
    // An unknown amount fails closed: compared as +∞, i.e. "over the amount" → owner only.
    ...evaluatePayApproval(
      {
        totalInclVat: inputs.amountKnown ? inputs.totalInclVat : Number.POSITIVE_INFINITY,
        supplierPriorInvoices: inputs.supplierPriorInvoices,
      },
      inputs.thresholds,
    ),
    inputs,
  };
}

/**
 * Throws unless `role` may approve this invoice for payment. Owner-only when the
 * rule says so. Otherwise the caller's normal role gate (W2-03) applies.
 */
export async function assertCanApproveForPayment(
  db: Database,
  ctx: { restaurantId: string; role: UserRole },
  invoiceId: string,
): Promise<PayApprovalDecision> {
  const decision = await payApprovalFor(db, ctx.restaurantId, invoiceId);
  if (!decision) throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice not found' });
  if (decision.requiresOwner && ctx.role !== 'owner') {
    throw appError(
      'FORBIDDEN',
      'payment.ownerApprovalRequired',
      'אישור לתשלום של חשבונית זו שמור לבעלים',
      {
        reasons: decision.reasons.join(','),
        amount: decision.inputs.totalInclVat,
        threshold: decision.inputs.thresholds.payApprovalOverAmount,
      },
    );
  }
  return decision;
}
