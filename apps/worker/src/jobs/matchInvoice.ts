import {
  buildRules,
  evaluateApproval,
  getEntitlements,
  logActivity,
  MockPushNotifier,
  MockWhatsAppNotifier,
  recordUsage,
  resolveApprovalThresholds,
  type ApprovalContext,
} from '@restomatch/api';
import {
  and,
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

    // Tenant guard: job payloads are not a trust boundary — verify the invoice
    // actually belongs to the payload's restaurant before any write.
    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(eq(invoices.id, job.data.invoiceId), eq(invoices.restaurantId, job.data.restaurantId)),
      )
      .limit(1);
    if (!invoice) {
      throw new Error(
        `[match-invoice] invoice=${job.data.invoiceId} not found in restaurant=${job.data.restaurantId} — refusing to match`,
      );
    }

    // Idempotency: if this invoice was already matched, skip — avoids duplicate
    // match_runs / discrepancies when a job is retried.
    const existingRun = await db
      .select({ id: matchRuns.id })
      .from(matchRuns)
      .where(
        and(
          eq(matchRuns.invoiceId, job.data.invoiceId),
          eq(matchRuns.restaurantId, job.data.restaurantId),
        ),
      )
      .limit(1);
    if (existingRun.length > 0) {
      console.log(
        `[match-invoice] invoice=${job.data.invoiceId} already matched — skipping (idempotent)`,
      );
      return { status: 'clean', totalDiscrepancyAmount: 0, discrepancies: [] };
    }

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
    // Per-restaurant approval-routing thresholds (settings.approvalThresholds).
    const rules = buildRules(resolveApprovalThresholds(restaurant?.settings?.approvalThresholds));
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
      const decision = evaluateApproval(ctx, rules);

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
          ruleId: decision.ruleId,
          ruleName: decision.ruleName,
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
      .where(
        and(eq(invoices.id, job.data.invoiceId), eq(invoices.restaurantId, job.data.restaurantId)),
      );

    // Fire notifications to each role needing attention. WhatsApp is a paid
    // feature (whatsapp_alerts) — gate it on entitlements so a basic/inactive
    // plan doesn't receive (and, once the real provider is wired, get billed
    // for) alerts it isn't entitled to. Push is always on.
    if (roleNeedsNotification.size > 0) {
      const ent = await getEntitlements(db, job.data.restaurantId);
      const whatsappAllowed = ent.active && ent.features.includes('whatsapp_alerts');
      const summary = `${result.discrepancies.length} חריגות, סה"כ הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`;
      for (const role of roleNeedsNotification) {
        if (whatsappAllowed) {
          await whatsapp.send(db, {
            restaurantId: job.data.restaurantId,
            channel: 'whatsapp',
            target: `role:${role}`,
            subject: 'דרושה החלטה לחשבונית',
            body: summary,
            relatedEntityType: 'match_run',
            relatedEntityId: matchRun.id,
          });
          if (ent.billingAccountId) {
            await recordUsage(db, ent.billingAccountId, 'whatsapp_sends');
          }
        }
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

    await logActivity(db, {
      restaurantId: job.data.restaurantId,
      eventType: 'invoice_matched',
      title: 'חשבונית הותאמה',
      detail: `${result.discrepancies.length} חריגות · הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`,
      entityType: 'match_run',
      entityId: matchRun.id,
    });

    console.log(
      `[match-invoice] restaurant=${job.data.restaurantId} invoice=${job.data.invoiceId} ` +
        `status=${result.status} discrepancies=${persistedIds.length} ` +
        `loss=₪${result.totalDiscrepancyAmount.toFixed(2)} ` +
        `notifications=${roleNeedsNotification.size}`,
    );

    return result;
  });
}
