import {
  and,
  discrepancies,
  eq,
  inArray,
  invoices,
  isNotNull,
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

/** A human decision on a discrepancy (approve / reject / escalate) to carry across a re-match. */
export interface PriorDecision {
  resolutionStatus: 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';
  resolvedBy: string | null;
  resolvedAt: Date;
  resolutionNote: string | null;
}

/**
 * Identity of a finding across match runs: its type plus the lines it is about.
 * Invoice / PO lines survive a re-match (only match_runs + discrepancies are
 * replaced), so the same finding on the same line gets the same key.
 */
export function discrepancyKey(d: {
  type: string;
  invoiceLineId?: string | null;
  poLineId?: string | null;
  productId?: string | null;
}): string {
  return [d.type, d.invoiceLineId ?? '', d.poLineId ?? '', d.productId ?? ''].join('|');
}

/**
 * Human decisions on the invoice's current discrepancies, by discrepancyKey —
 * read BEFORE a re-match deletes the old runs, so a bookkeeper's "not a
 * duplicate" (or an approval) is not silently reset to open. Engine
 * auto-approvals (no resolvedAt) are not carried: the new run re-decides them.
 */
export async function loadPriorDecisions(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<Map<string, PriorDecision>> {
  const runs = await db
    .select({ id: matchRuns.id })
    .from(matchRuns)
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
  const out = new Map<string, PriorDecision>();
  if (runs.length === 0) return out;
  const rows = await db
    .select({
      type: discrepancies.type,
      invoiceLineId: discrepancies.invoiceLineId,
      poLineId: discrepancies.poLineId,
      productId: discrepancies.productId,
      resolutionStatus: discrepancies.resolutionStatus,
      resolvedBy: discrepancies.resolvedBy,
      resolvedAt: discrepancies.resolvedAt,
      resolutionNote: discrepancies.resolutionNote,
    })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        inArray(
          discrepancies.matchRunId,
          runs.map((r) => r.id),
        ),
        isNotNull(discrepancies.resolvedAt),
      ),
    );
  for (const r of rows) {
    const key = discrepancyKey(r);
    const prev = out.get(key);
    if (prev && prev.resolvedAt >= r.resolvedAt!) continue; // keep the latest decision
    out.set(key, {
      resolutionStatus: r.resolutionStatus,
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt!,
      resolutionNote: r.resolutionNote,
    });
  }
  return out;
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
  /** Decisions from the run this one replaces (loadPriorDecisions); kept on findings that still exist. */
  priorDecisions?: Map<string, PriorDecision>,
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
    const prior = priorDecisions?.get(discrepancyKey(d));

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
      resolutionStatus: prior?.resolutionStatus ?? initialStatus,
      resolvedBy: prior?.resolvedBy ?? null,
      resolvedAt: prior?.resolvedAt ?? null,
      resolutionNote: prior?.resolutionNote ?? null,
    });

    if (!prior && decision.requiredRole && decision.action !== 'auto_approve') {
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
      result.discrepancies.length === 1 ? 'חריגה אחת' : `${result.discrepancies.length} חריגות`,
      `הפסד פוטנציאלי ₪${lossIls.toLocaleString('he-IL')}`,
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
