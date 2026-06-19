import {
  buildMatchInputForInvoice,
  buildRules,
  createPushNotifier,
  createWhatsAppNotifier,
  getEntitlements,
  persistMatchRun,
  recordUsage,
  resolveApprovalThresholds,
} from '@restomatch/api';
import { and, createDb, eq, invoices, matchRuns, restaurants } from '@restomatch/db';
import { runMatch, type MatchOutput } from '@restomatch/matching';
import { makeWorker } from '../queue';

/**
 * The producer sends only identifiers; the worker discovers the PO/GR and
 * assembles the MatchInput server-side (buildMatchInputForInvoice). This removes
 * the producer-supplied-MatchInput trust boundary the previous contract had.
 */
export interface MatchInvoiceJob {
  restaurantId: string;
  invoiceId: string;
}

// Env-gated provider selection: real WhatsApp Cloud when
// WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set, else the mock.
// Push has no real provider yet (always mock).
const whatsapp = createWhatsAppNotifier();
const push = createPushNotifier();

export function startMatchInvoiceWorker() {
  return makeWorker<MatchInvoiceJob>('match-invoice', async (job): Promise<MatchOutput> => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);
    const { restaurantId, invoiceId } = job.data;

    // Tenant guard: job payloads are not a trust boundary — verify the invoice
    // actually belongs to the payload's restaurant before any write.
    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1);
    if (!invoice) {
      throw new Error(
        `[match-invoice] invoice=${invoiceId} not found in restaurant=${restaurantId} — refusing to match`,
      );
    }

    // Idempotency: if this invoice was already matched, skip — avoids duplicate
    // match_runs / discrepancies when a job is retried.
    const existingRun = await db
      .select({ id: matchRuns.id })
      .from(matchRuns)
      .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)))
      .limit(1);
    if (existingRun.length > 0) {
      console.log(`[match-invoice] invoice=${invoiceId} already matched — skipping (idempotent)`);
      return { status: 'clean', totalDiscrepancyAmount: 0, discrepancies: [] };
    }

    // Discover the PO + assemble the 3-way MatchInput (tolerances/vat/baselines
    // resolved from the restaurant inside the assembler).
    const built = await buildMatchInputForInvoice(db, restaurantId, invoiceId);
    if (!built) {
      console.warn(`[match-invoice] invoice=${invoiceId} has no lines to match — skipping`);
      return { status: 'clean', totalDiscrepancyAmount: 0, discrepancies: [] };
    }

    // Per-restaurant approval-routing thresholds (settings.approvalThresholds).
    const [restaurant] = await db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    const rules = buildRules(resolveApprovalThresholds(restaurant?.settings?.approvalThresholds));

    const result = runMatch(built.input);
    const persisted = await persistMatchRun(
      db,
      { restaurantId, invoiceId, poId: built.poId, grId: built.grId },
      built.input,
      result,
      rules,
    );

    // Fire notifications to each role needing attention. WhatsApp is a paid
    // feature (whatsapp_alerts) — gate it on entitlements. Push is always on.
    if (persisted.rolesNeedingNotification.length > 0) {
      const ent = await getEntitlements(db, restaurantId);
      const whatsappAllowed = ent.active && ent.features.includes('whatsapp_alerts');
      const summary = `${result.discrepancies.length} חריגות, סה"כ הפסד פוטנציאלי ₪${result.totalDiscrepancyAmount.toFixed(0)}`;
      for (const role of persisted.rolesNeedingNotification) {
        if (whatsappAllowed) {
          await whatsapp.send(db, {
            restaurantId,
            channel: 'whatsapp',
            target: `role:${role}`,
            subject: 'דרושה החלטה לחשבונית',
            body: summary,
            relatedEntityType: 'match_run',
            relatedEntityId: persisted.matchRunId,
          });
          if (ent.billingAccountId) {
            await recordUsage(db, ent.billingAccountId, 'whatsapp_sends');
          }
        }
        await push.send(db, {
          restaurantId,
          channel: 'push',
          target: `role:${role}`,
          subject: 'דרושה החלטה',
          body: summary,
          relatedEntityType: 'match_run',
          relatedEntityId: persisted.matchRunId,
        });
      }
    }

    console.log(
      `[match-invoice] restaurant=${restaurantId} invoice=${invoiceId} ` +
        `status=${result.status} discrepancies=${persisted.discrepancyCount} ` +
        `loss=₪${result.totalDiscrepancyAmount.toFixed(2)} ` +
        `notifications=${persisted.rolesNeedingNotification.length}`,
    );

    return result;
  });
}
