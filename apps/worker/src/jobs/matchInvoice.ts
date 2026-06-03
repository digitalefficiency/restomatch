import {
  DEFAULT_RULES,
  evaluateApproval,
  MockPushNotifier,
  MockWhatsAppNotifier,
  type ApprovalContext,
} from '@restomatch/api';
import {
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  restaurants,
  type UserRole,
} from '@restomatch/db';
import { resolveTolerances, runMatch, type MatchInput, type MatchOutput } from '@restomatch/matching';
import { makeWorker } from '../queue';

export interface MatchInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  input: MatchInput;
}

const whatsapp = new MockWhatsAppNotifier();
const push = new MockPushNotifier();

export function startMatchInvoiceWorker() {
  return makeWorker<MatchInvoiceJob>('match-invoice', async (job): Promise<MatchOutput> => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    // Per-restaurant tolerances (settings.tolerances) are authoritative here —
    // this is what makes the multi-tenant config live instead of dead code.
    const [restaurant] = await db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, job.data.restaurantId))
      .limit(1);
    const input: MatchInput = {
      ...job.data.input,
      tolerances: resolveTolerances(restaurant?.settings?.tolerances),
    };
    const result = runMatch(input);

    // Persist match_run
    const [matchRun] = await db
      .insert(matchRuns)
      .values({
        restaurantId: job.data.restaurantId,
        invoiceId: job.data.invoiceId,
        overallStatus: result.status,
        totalDiscrepancyAmount: result.totalDiscrepancyAmount.toString(),
      })
      .returning();
    if (!matchRun) throw new Error('failed to insert match_run');

    // Evaluate + persist each discrepancy with required_role
    const totalInvoiceAmount = input.invoice.totalInclVat;
    const persistedIds: string[] = [];
    const roleNeedsNotification = new Set<UserRole>();

    for (const d of result.discrepancies) {
      const ctx: ApprovalContext = {
        discrepancy: {
          type: d.type,
          severity: d.severity,
          deltaAmount: d.deltaAmount,
        },
        matchRun: {
          totalDiscrepancyAmount: result.totalDiscrepancyAmount,
          totalInvoiceAmount,
          poExists: input.poLines.length > 0,
        },
      };
      const decision = evaluateApproval(ctx, DEFAULT_RULES);

      const initialStatus =
        decision.action === 'auto_approve' ? 'accepted' : 'open';

      const [persisted] = await db
        .insert(discrepancies)
        .values({
          matchRunId: matchRun.id,
          restaurantId: job.data.restaurantId,
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
          resolutionStatus: initialStatus,
        })
        .returning({ id: discrepancies.id });
      if (persisted) persistedIds.push(persisted.id);

      if (decision.requiredRole && decision.action !== 'auto_approve') {
        roleNeedsNotification.add(decision.requiredRole);
      }
    }

    // Update invoice status based on aggregate decision
    const finalInvoiceStatus =
      result.status === 'blocked' ? 'disputed' : result.status === 'clean' ? 'matched' : 'matched';
    await db
      .update(invoices)
      .set({ status: finalInvoiceStatus })
      .where(eq(invoices.id, job.data.invoiceId));

    // Fire mocked notifications to each role needing attention
    if (roleNeedsNotification.size > 0) {
      const summary = `${result.discrepancies.length} חריגות, סה"כ הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`;
      for (const role of roleNeedsNotification) {
        await whatsapp.send(db, {
          restaurantId: job.data.restaurantId,
          channel: 'whatsapp',
          target: `role:${role}`,
          subject: 'דרושה החלטה לחשבונית',
          body: summary,
          relatedEntityType: 'match_run',
          relatedEntityId: matchRun.id,
        });
        await push.send(db, {
          restaurantId: job.data.restaurantId,
          channel: 'push',
          target: `role:${role}`,
          subject: 'דרושה החלטה',
          body: summary,
          relatedEntityType: 'match_run',
          relatedEntityId: matchRun.id,
        });
      }
    }

    console.log(
      `[match-invoice] restaurant=${job.data.restaurantId} invoice=${job.data.invoiceId} ` +
        `status=${result.status} discrepancies=${persistedIds.length} ` +
        `loss=₪${result.totalDiscrepancyAmount.toFixed(2)} ` +
        `notifications=${roleNeedsNotification.size}`,
    );

    return result;
  });
}
