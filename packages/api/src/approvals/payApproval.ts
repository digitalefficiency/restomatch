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
  totalInclVat: number;
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
    .select({ total: invoices.totalInclVat, supplierId: invoices.supplierId })
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
  return { totalInclVat: Number(inv.total ?? 0), supplierPriorInvoices, thresholds };
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
    ...evaluatePayApproval(
      { totalInclVat: inputs.totalInclVat, supplierPriorInvoices: inputs.supplierPriorInvoices },
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
