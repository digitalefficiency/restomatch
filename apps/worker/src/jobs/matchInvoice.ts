import {
  approvalNeededEmail,
  buildMatchInputForInvoice,
  buildRules,
  createEmailNotifier,
  createPushNotifier,
  createWhatsAppNotifier,
  getEntitlements,
  loadPriorDecisions,
  receiptStillOpen,
  persistMatchRun,
  recipientsForRestaurant,
  recordUsage,
  resolveApprovalThresholds,
} from '@restomatch/api';
import { and, desc, eq, invoices, matchRuns, restaurants, suppliers, type Database } from '@restomatch/db';
import { runMatch, type MatchOutput } from '@restomatch/matching';
import { makeWorker } from '../queue';
import { appBaseUrl } from '../lib/notifyHelpers';
import { jobDb } from '../db';
import { findJobInvoice } from './findJobInvoice';

/**
 * The producer sends only identifiers; the worker discovers the PO/GR and
 * assembles the MatchInput server-side (buildMatchInputForInvoice). This removes
 * the producer-supplied-MatchInput trust boundary the previous contract had.
 */
export interface MatchInvoiceJob {
  restaurantId: string;
  invoiceId: string;
  /**
   * Set by receiving.submitReceipt: the receipt is now counted, so a run made
   * before the count (gr_lines empty → every line "short") must be replaced.
   * Without it the job stays idempotent (an already-matched invoice is skipped).
   */
  rematch?: boolean;
  /**
   * The PO of the receipt the invoice was scanned on (receiving.submitReceipt).
   * It wins over a PO an earlier run discovered: the receiver counted THIS
   * order. Still subject to the assembler's same-supplier / ±window checks.
   */
  poId?: string;
}

const CLEAN: MatchOutput = { status: 'clean', totalDiscrepancyAmount: 0, discrepancies: [] };

export interface MatchJobOutcome {
  result: MatchOutput;
  /** The new run, or null when the job had nothing to do. */
  persisted: Awaited<ReturnType<typeof persistMatchRun>> | null;
  /** True when this run replaced an earlier run of the same invoice. */
  replaced: boolean;
  /** Why nothing ran (logs/tests). */
  skipped?: 'ocr_pending' | 'already_matched' | 'awaiting_review' | 'no_lines' | 'settled' | 'po_rejected' | 'receipt_open';
}

/**
 * The match-invoice job without its notifications (tested directly).
 *
 *  • an invoice still in OCR is a no-op — the OCR job matches it when it lands
 *    (covers a receipt submitted before its invoice finished reading);
 *  • a plain job on an already-matched invoice is a no-op (idempotent retries);
 *  • a `rematch` replaces the earlier run against the same PO and keeps the
 *    people's decisions on findings that still exist (as match.runForInvoice);
 *  • a `rematch` of a never-matched invoice honours the OCR gate: an invoice the
 *    OCR held for a human (low confidence → 'parsed', or a possible duplicate)
 *    still waits for that human.
 */
export async function matchInvoiceForJob(db: Database, data: MatchInvoiceJob): Promise<MatchJobOutcome> {
  const { restaurantId, invoiceId } = data;
  const [inv] = await db
    .select({ status: invoices.status, ocrPayload: invoices.ocrPayload })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv || inv.status === 'ocr_pending') {
    return { result: CLEAN, persisted: null, replaced: false, skipped: 'ocr_pending' };
  }

  const [priorRun] = await db
    .select({ id: matchRuns.id, poId: matchRuns.poId })
    .from(matchRuns)
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)))
    .orderBy(desc(matchRuns.runAt))
    .limit(1);
  if (priorRun && !data.rematch) {
    return { result: CLEAN, persisted: null, replaced: false, skipped: 'already_matched' };
  }
  // A person already signed this invoice off: a receipt submit never rewrites
  // its match (only match.runForInvoice, a manager action, may).
  if (priorRun && data.rematch && (inv.status === 'approved' || inv.status === 'paid')) {
    return { result: CLEAN, persisted: null, replaced: false, skipped: 'settled' };
  }
  if (!priorRun && data.rematch) {
    const raw = inv.ocrPayload?.raw as { duplicateOf?: unknown } | null | undefined;
    if (inv.status !== 'matched' || raw?.duplicateOf !== undefined) {
      return { result: CLEAN, persisted: null, replaced: false, skipped: 'awaiting_review' };
    }
  }

  // Discover the PO + assemble the 3-way MatchInput (tolerances/vat/baselines
  // resolved from the restaurant inside the assembler). The receipt's PO first,
  // else a re-match stays on the PO it was matched against.
  const built = await buildMatchInputForInvoice(db, restaurantId, invoiceId, {
    pinnedPoId: data.poId ?? priorRun?.poId ?? null,
  });
  if (!built) return { result: CLEAN, persisted: null, replaced: false, skipped: 'no_lines' };
  // The payload is not a trust boundary. A job's poId names the order that was
  // counted for this invoice: if the matcher wouldn't pair the invoice with it
  // (other supplier, outside the window, a sibling PO preferred), don't fall back
  // to some other order — skip.
  if (data.poId && built.poId !== data.poId) {
    console.warn(`[match-invoice] invoice=${invoiceId} does not pair with the job's po=${data.poId} — skipping`);
    return { result: CLEAN, persisted: null, replaced: false, skipped: 'po_rejected' };
  }
  // Never match against a receipt that is still being counted (every line would
  // read "received 0"). Takes the receipt lock, so the job a submit enqueues
  // waits for that submit to commit.
  if (built.grId) {
    const grId = built.grId;
    const open = await db.transaction((tx) => receiptStillOpen(tx as unknown as Database, restaurantId, grId));
    if (open) return { result: CLEAN, persisted: null, replaced: false, skipped: 'receipt_open' };
  }

  // Per-restaurant approval-routing thresholds (settings.approvalThresholds).
  const [restaurant] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const rules = buildRules(resolveApprovalThresholds(restaurant?.settings?.approvalThresholds));
  const result = runMatch(built.input);

  const persisted = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Database;
    let prior: Awaited<ReturnType<typeof loadPriorDecisions>> | undefined;
    if (priorRun) {
      prior = await loadPriorDecisions(tx, restaurantId, invoiceId);
      await tx
        .delete(matchRuns)
        .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
    }
    return persistMatchRun(
      tx,
      { restaurantId, invoiceId, poId: built.poId, grId: built.grId },
      built.input,
      result,
      rules,
      prior,
    );
  });
  return { result, persisted, replaced: Boolean(priorRun) };
}

// Env-gated provider selection: real WhatsApp Cloud when
// WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set, else the mock.
// Push has no real provider yet (always mock).
const whatsapp = createWhatsAppNotifier();
const push = createPushNotifier();
// Real Resend email when RESEND_API_KEY is set, else dev/console EmailNotifier.
const email = createEmailNotifier();

export function startMatchInvoiceWorker() {
  return makeWorker<MatchInvoiceJob>('match-invoice', async (job): Promise<MatchOutput> => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = jobDb(url);
    const { restaurantId, invoiceId } = job.data;

    // Tenant guard: job payloads are not a trust boundary — verify the invoice
    // actually belongs to the payload's restaurant before any write. Re-read
    // briefly first, in case the producer enqueued before its commit.
    const invoice = await findJobInvoice(db, restaurantId, invoiceId);
    if (!invoice) {
      throw new Error(
        `[match-invoice] invoice=${invoiceId} not found in restaurant=${restaurantId} — refusing to match`,
      );
    }

    const { result, persisted, replaced, skipped } = await matchInvoiceForJob(db, job.data);
    if (!persisted) {
      console.log(`[match-invoice] invoice=${invoiceId} — nothing to do (${skipped})`);
      return result;
    }

    // Fire notifications to each role needing attention. WhatsApp is a paid
    // feature (whatsapp_alerts) — gate it on entitlements. Push is always on.
    // A re-match after the count replaces a run whose people were already told;
    // only a first match notifies (the approvals queue shows the fresh numbers).
    if (!replaced && persisted.rolesNeedingNotification.length > 0) {
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

      // Email the REAL mailbox of each manager-tier recipient — the
      // "we caught a ₪ leak, decide now" moment. (WhatsApp/push above use the
      // symbolic role: target; email needs concrete addresses.) Idempotent at
      // the job level: an already-matched invoice skips this whole block.
      const recipients = await recipientsForRestaurant(
        db,
        restaurantId,
        persisted.rolesNeedingNotification,
      );
      if (recipients.length > 0) {
        const [sup] = await db
          .select({ name: suppliers.name })
          .from(invoices)
          .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
          .where(eq(invoices.id, invoiceId))
          .limit(1);
        const rendered = approvalNeededEmail({
          supplierName: sup?.name ?? 'ספק',
          discrepancyCount: result.discrepancies.length,
          atRiskIls: `₪${result.totalDiscrepancyAmount.toFixed(0)}`,
          approvalsUrl: `${appBaseUrl()}/dashboard/approvals`,
        });
        for (const r of recipients) {
          await email.send(db, {
            restaurantId,
            channel: 'email',
            target: r.email,
            subject: rendered.subject,
            body: rendered.text,
            html: rendered.html,
            relatedEntityType: 'match_run',
            relatedEntityId: persisted.matchRunId,
          });
        }
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
