import {
  and,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  type Database,
  type UserRole,
} from '@restomatch/db';
import type { MatchInput, MatchOutput } from '@restomatch/matching';
import { evaluateApproval, type ApprovalContext } from '../approvals/engine';
import { buildRules } from '../approvals/engine';
import { logActivity } from '../activity';

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

  await logActivity(db, {
    restaurantId: args.restaurantId,
    eventType: 'invoice_matched',
    title: 'חשבונית הותאמה',
    detail: `${result.discrepancies.length} חריגות · הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`,
    entityType: 'match_run',
    entityId: matchRun.id,
  });

  return {
    matchRunId: matchRun.id,
    rolesNeedingNotification: [...rolesNeedingNotification],
    discrepancyCount: result.discrepancies.length,
  };
}
