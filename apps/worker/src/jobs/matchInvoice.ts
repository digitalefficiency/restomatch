import {
  approvalNeededEmail,
  buildMatchInputForInvoice,
  claimableLines,
  buildRules,
  createEmailNotifier,
  createPushNotifier,
  createWhatsAppNotifier,
  getEntitlements,
  loadPriorDecisions,
  materializeClaims,
  releaseClaimsForRematch,
  receiptStillOpen,
  persistMatchRun,
  rematchHoldReason,
  recipientsForRestaurant,
  recordUsage,
  resolveApprovalThresholds,
  formatIlsAgorot,
} from '@restomatch/api';
import { computeInvoiceLeak } from '@restomatch/charts';
import {
  and,
  desc,
  discrepancies,
  eq,
  inArray,
  invoices,
  isNotNull,
  matchRuns,
  restaurants,
  suppliers,
  type Database,
} from '@restomatch/db';
import { runMatch, type MatchOutput } from '@restomatch/matching';
import { makeWorker, type WorkerJob } from '../queue';
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
  skipped?:
    | 'ocr_pending'
    | 'already_matched'
    | 'awaiting_review'
    | 'no_lines'
    | 'settled'
    | 'po_rejected'
    | 'receipt_open'
    /** A claim on the old run has money history (letter / credit): keep the run, don't retry. */
    | 'claims_in_progress';
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
export async function matchInvoiceForJob(
  db: Database,
  data: MatchInvoiceJob,
): Promise<MatchJobOutcome> {
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
  // A person already signed this invoice off (a receipt submit never rewrites
  // its match — only match.runForInvoice, a manager action, may), or the OCR
  // held a never-matched invoice for a human. Shared with the dock slip.
  if (data.rematch) {
    const hold = rematchHoldReason(inv, Boolean(priorRun));
    if (hold) return { result: CLEAN, persisted: null, replaced: false, skipped: hold };
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
    console.warn(
      `[match-invoice] invoice=${invoiceId} does not pair with the job's po=${data.poId} — skipping`,
    );
    return { result: CLEAN, persisted: null, replaced: false, skipped: 'po_rejected' };
  }
  // Never match against a receipt that is still being counted (every line would
  // read "received 0"). Takes the receipt lock, so the job a submit enqueues
  // waits for that submit to commit.
  if (built.grId) {
    const grId = built.grId;
    const open = await db.transaction((tx) =>
      receiptStillOpen(tx as unknown as Database, restaurantId, grId),
    );
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

  let persisted: Awaited<ReturnType<typeof persistMatchRun>>;
  try {
    persisted = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Database;
      let prior: Awaited<ReturnType<typeof loadPriorDecisions>> | undefined;
      if (priorRun) {
        // Claims reference the discrepancies about to be deleted (FK). Release the
        // bare ones first; a claim with money history (letter, credit) refuses the
        // re-match with CONFLICT, which fails this job loudly (never swallowed).
        await releaseClaimsForRematch(tx, restaurantId, invoiceId);
        prior = await loadPriorDecisions(tx, restaurantId, invoiceId);
        await tx
          .delete(matchRuns)
          .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
      }
      const out = await persistMatchRun(
        tx,
        { restaurantId, invoiceId, poId: built.poId, grId: built.grId },
        built.input,
        result,
        rules,
        prior,
      );
      if (priorRun) await rebindDecidedClaims(tx, restaurantId, out.matchRunId);
      return out;
    });
  } catch (err) {
    // releaseClaimsForRematch refused: a claim of the old run already has money
    // history. Retrying can never succeed, so keep the existing run, write ONE
    // ops line and skip (the tx rolled back; nothing was deleted).
    if ((err as { code?: string }).code === 'CONFLICT') {
      console.warn(
        `[match-invoice] restaurant=${restaurantId} invoice=${invoiceId} re-match skipped: ${(err as Error).message}`,
      );
      return { result: CLEAN, persisted: null, replaced: false, skipped: 'claims_in_progress' };
    }
    throw err;
  }
  return { result, persisted, replaced: Boolean(priorRun) };
}

// Env-gated provider selection: real WhatsApp Cloud when
// WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set, else the mock.
// Push has no real provider yet (always mock).
const whatsapp = createWhatsAppNotifier();
const push = createPushNotifier();
// Real Resend email when RESEND_API_KEY is set, else dev/console EmailNotifier.
const email = createEmailNotifier();

/**
 * After a re-match, the people's decisions were re-applied to the findings that
 * still exist. Their claims (released above) come back under the ORIGINAL
 * decider (`resolved_by`), never the job — one `materializeClaims` per decider.
 */
async function rebindDecidedClaims(
  tx: Database,
  restaurantId: string,
  matchRunId: string,
): Promise<void> {
  const decided = await tx
    .select({ id: discrepancies.id, by: discrepancies.resolvedBy })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        eq(discrepancies.matchRunId, matchRunId),
        inArray(discrepancies.resolutionStatus, ['accepted', 'resolved']),
        isNotNull(discrepancies.resolvedBy),
      ),
    );
  const byDecider = new Map<string, string[]>();
  for (const d of decided) byDecider.set(d.by!, [...(byDecider.get(d.by!) ?? []), d.id]);
  for (const [actorId, discrepancyIds] of byDecider) {
    await materializeClaims(tx, { restaurantId, discrepancyIds, actorId });
  }
}

/**
 * The branch-aware deep link of every approval notification (ia-nav-09):
 * `/dashboard/go?r=<restaurantId>&to=/dashboard/approvals?invoice=<id>`.
 */
export function approvalsGoLink(
  restaurantId: string,
  invoiceId: string | null,
  base = appBaseUrl(),
): string {
  const to = invoiceId ? `/dashboard/approvals?invoice=${invoiceId}` : '/dashboard/approvals';
  return `${base}/dashboard/go?r=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(to)}`;
}

/** Σ claimable agorot of one invoice: `claimableLines(computeInvoiceLeak(id))`. */
export async function invoiceClaimAgorot(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<number> {
  return (await invoiceClaim(db, restaurantId, invoiceId)).agorot;
}

/**
 * The invoice's claimable ₪ on the BEFORE-VAT basis only (a duplicate's incl.
 * VAT or a VAT amount is never added into it), and whether it still waits for
 * its PO link (then there is nothing to claim yet, and the copy says so).
 */
export async function invoiceClaim(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<{ agorot: number; pendingLink: boolean }> {
  const inv = await computeInvoiceLeak(db, restaurantId, invoiceId);
  if (!inv) return { agorot: 0, pendingLink: false };
  const agorot = claimableLines(inv)
    .filter((c) => c.basis === 'excl')
    .reduce((n, c) => n + Math.round(c.amount * 100), 0);
  return { agorot, pendingLink: inv.pendingLink };
}

/** Push / WhatsApp body: "N פערים · ₪X לדרישת זיכוי" + the link. No baked ₪ template string. */
export function approvalSummary(count: number, claimAgorot: number, link: string): string {
  const gaps = count === 1 ? 'פער אחד' : `${count} פערים`;
  const money =
    claimAgorot > 0
      ? ` · ${formatIlsAgorot(claimAgorot, { maximumFractionDigits: 2 })} לדרישת זיכוי`
      : '';
  return `${gaps} בחשבונית${money}\n${link}`;
}

export function startMatchInvoiceWorker() {
  return makeWorker<MatchInvoiceJob>('match-invoice', processMatchInvoice);
}

/** The match-invoice job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processMatchInvoice(job: WorkerJob<MatchInvoiceJob>): Promise<MatchOutput> {
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
    // ₪ = what this invoice can actually claim (the letters' rule), never the
    // engine's raw Σ|Δ|; formatted once by the server money util.
    const { agorot: claimAgorot, pendingLink } = await invoiceClaim(db, restaurantId, invoiceId);
    const link = approvalsGoLink(restaurantId, invoiceId);
    const summary = approvalSummary(result.discrepancies.length, claimAgorot, link);
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
        // TODO(W2-13 13a): `claimableIls` + `invoiceUrl` once the template takes them (one line).
        // ₪ only when there is ₪ to claim; never "₪0.00 בסיכון".
        atRiskIls:
          claimAgorot > 0
            ? formatIlsAgorot(claimAgorot, { maximumFractionDigits: 2 })
            : pendingLink
              ? 'ממתין לקישור להזמנה'
              : 'ללא סכום לדרישה',
        approvalsUrl: link,
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
      `deltaAgorot=${Math.round(result.totalDiscrepancyAmount * 100)} ` +
      `notifications=${persisted.rolesNeedingNotification.length}`,
  );

  return result;
}
