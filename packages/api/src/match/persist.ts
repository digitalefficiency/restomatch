import {
  and,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  suppliers,
  type Database,
  type UserRole,
} from '@restomatch/db';
import type { MatchInput, MatchOutput } from '@restomatch/matching';
import { evaluateApproval, type ApprovalContext } from '../approvals/engine';
import { buildRules } from '../approvals/engine';
import { logActivity } from '../activity';
import { writePriceHistoryForInvoice } from './priceHistory';

export interface PersistMatchArgs {
  restaurantId: string;
  invoiceId: string;
  poId: string | null;
  grId: string | null;
}

export interface PersistMatchResult {
  matchRunId: string;
  /** Roles that an open (non-auto-approved) discrepancy routed to — the worker
   *  notifies these; the interactive router ignores them. */
  rolesNeedingNotification: UserRole[];
  discrepancyCount: number;
}

/**
 * Persist a match run: the match_run row (with PO/GR provenance), each
 * discrepancy routed through the approval engine, the resulting invoice status,
 * and an activity-feed entry. Shared by the background match-invoice worker and
 * the interactive match.runForInvoice procedure so they stay byte-identical.
 */
export async function persistMatchRun(
  db: Database,
  args: PersistMatchArgs,
  input: MatchInput,
  result: MatchOutput,
  rules: ReturnType<typeof buildRules>,
): Promise<PersistMatchResult> {
  const [matchRun] = await db
    .insert(matchRuns)
    .values({
      restaurantId: args.restaurantId,
      invoiceId: args.invoiceId,
      poId: args.poId,
      grId: args.grId,
      overallStatus: result.status,
      totalDiscrepancyAmount: result.totalDiscrepancyAmount.toString(),
    })
    .returning();
  if (!matchRun) throw new Error('failed to insert match_run');

  const totalInvoiceAmount = input.invoice.totalInclVat;
  const rolesNeedingNotification = new Set<UserRole>();

  for (const d of result.discrepancies) {
    const ctx: ApprovalContext = {
      discrepancy: { type: d.type, severity: d.severity, deltaAmount: d.deltaAmount },
      matchRun: {
        totalDiscrepancyAmount: result.totalDiscrepancyAmount,
        totalInvoiceAmount,
        poExists: input.poLines.length > 0,
      },
    };
    const decision = evaluateApproval(ctx, rules);
    const initialStatus = decision.action === 'auto_approve' ? 'accepted' : 'open';

    await db.insert(discrepancies).values({
      matchRunId: matchRun.id,
      restaurantId: args.restaurantId,
      type: d.type,
      severity: d.severity,
      productId: d.productId,
      poLineId: d.poLineId ?? null,
      grLineId: d.grLineId ?? null,
      invoiceLineId: d.invoiceLineId ?? null,
      expectedValue: d.expected?.toString() ?? null,
      actualValue: d.actual?.toString() ?? null,
      deltaAmount: d.deltaAmount.toString(),
      toleranceUsed: d.toleranceUsed,
      requiresRole: decision.requiredRole,
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      resolutionStatus: initialStatus,
    });

    if (decision.requiredRole && decision.action !== 'auto_approve') {
      rolesNeedingNotification.add(decision.requiredRole);
    }
  }

  const finalInvoiceStatus = result.status === 'blocked' ? 'disputed' : 'matched';
  await db
    .update(invoices)
    .set({ status: finalInvoiceStatus })
    .where(and(eq(invoices.id, args.invoiceId), eq(invoices.restaurantId, args.restaurantId)));

  // Feed the leak detective / price baselines (M1). Idempotent per invoice; a
  // duplicate invoice is not written (it would double-weight its prices).
  await writePriceHistoryForInvoice(db, args.restaurantId, args.invoiceId, {
    skip: result.discrepancies.some((d) => d.type === 'DUPLICATE_INVOICE'),
  });

  // Activity entry: the Hebrew sentence (rendered as-is in Hebrew, and parsed by
  // the web's activityText templates) plus structured metadata so any locale can
  // render it from numbers rather than text.
  const [meta] = await db
    .select({ invoiceNumber: invoices.invoiceNumber, supplierName: suppliers.name, supplierNameEn: suppliers.nameEn })
    .from(invoices)
    .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, args.restaurantId)))
    .where(and(eq(invoices.id, args.invoiceId), eq(invoices.restaurantId, args.restaurantId)))
    .limit(1);
  const lossIls = Math.round(result.totalDiscrepancyAmount);
  await logActivity(db, {
    restaurantId: args.restaurantId,
    eventType: 'invoice_matched',
    title: meta?.invoiceNumber ? `חשבונית ${meta.invoiceNumber} הותאמה` : 'חשבונית הותאמה',
    detail: [
      meta?.supplierName ?? null,
      `${result.discrepancies.length} חריגות`,
      `הפסד פוטנציאלי ₪${lossIls}`,
    ]
      .filter(Boolean)
      .join(' · '),
    entityType: 'match_run',
    entityId: matchRun.id,
    metadata: {
      invoiceId: args.invoiceId,
      invoiceNumber: meta?.invoiceNumber ?? null,
      supplierName: meta?.supplierName ?? null,
      supplierNameEn: meta?.supplierNameEn ?? null,
      discrepancyCount: result.discrepancies.length,
      potentialLossIls: result.totalDiscrepancyAmount,
      status: result.status,
    },
  });

  return {
    matchRunId: matchRun.id,
    rolesNeedingNotification: [...rolesNeedingNotification],
    discrepancyCount: result.discrepancies.length,
  };
}
