import {
  and,
  discrepancies,
  eq,
  inArray,
  invoices,
  isNotNull,
  ne,
  or,
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
  /** Null for an escalation (it is a hand-off, not a resolution). */
  resolvedAt: Date | null;
  resolutionNote: string | null;
  /** Escalation moves the finding to the owner — keep that routing too. */
  requiresRole: UserRole | null;
}

/** A finding as both the old rows and the new engine output describe it. */
export interface FindingIdentity {
  type: string;
  invoiceLineId?: string | null;
  poLineId?: string | null;
  productId?: string | null;
  deltaAmount: number | string | null;
  expected?: number | string | null;
  actual?: number | string | null;
}

/**
 * Identity of a finding across match runs: its type plus the lines it is about.
 * Invoice / PO lines survive a re-match (only match_runs + discrepancies are
 * replaced), so the same finding on the same line gets the same key.
 */
export function discrepancyKey(d: Pick<FindingIdentity, 'type' | 'invoiceLineId' | 'poLineId' | 'productId'>): string {
  return [d.type, d.invoiceLineId ?? '', d.poLineId ?? '', d.productId ?? ''].join('|');
}

const num4 = (v: number | string | null | undefined) => (v == null ? '' : Number(v).toFixed(4));
/** Key + the amounts: tells apart two findings of one type on one line (e.g. two QTY_OVER). */
const fingerprint = (d: FindingIdentity) =>
  `${discrepancyKey(d)}|${num4(d.deltaAmount)}|${num4(d.expected)}|${num4(d.actual)}`;

/**
 * Pair the old run's human decisions with the new run's findings; returns one
 * entry per finding (undefined = nothing to carry). Each decision is used at
 * most once: first findings whose key AND amounts are unchanged; then, per key,
 * a leftover pair only when exactly one old decision and one new finding remain
 * (the same finding with a changed amount). Anything ambiguous starts fresh —
 * better a finding back in the queue than a decision applied to the wrong one.
 */
export function pairPriorDecisions(
  prior: Array<FindingIdentity & { decision: PriorDecision }>,
  findings: FindingIdentity[],
): Array<PriorDecision | undefined> {
  const out: Array<PriorDecision | undefined> = findings.map(() => undefined);
  const left = new Set(prior.map((_, i) => i));
  findings.forEach((f, i) => {
    const fp = fingerprint(f);
    const j = [...left].find((k) => fingerprint(prior[k]!) === fp);
    if (j !== undefined) {
      out[i] = prior[j]!.decision;
      left.delete(j);
    }
  });
  const byKey = new Map<string, { olds: number[]; news: number[] }>();
  for (const k of left) {
    const key = discrepancyKey(prior[k]!);
    const g = byKey.get(key) ?? { olds: [], news: [] };
    g.olds.push(k);
    byKey.set(key, g);
  }
  findings.forEach((f, i) => {
    if (out[i]) return;
    const g = byKey.get(discrepancyKey(f));
    if (g) g.news.push(i);
  });
  for (const g of byKey.values()) {
    if (g.olds.length === 1 && g.news.length === 1) out[g.news[0]!] = prior[g.olds[0]!]!.decision;
  }
  return out;
}

/**
 * Human decisions on the invoice's current discrepancies (approved / rejected /
 * resolved — resolved_at set — and escalated), read BEFORE a re-match deletes the
 * old runs so a bookkeeper's "not a duplicate", an approval or an escalation to
 * the owner is not silently reset to open. Engine auto-approvals (no
 * resolved_at) are not carried: the new run re-decides them. Pair them with the
 * new findings via pairPriorDecisions.
 */
export async function loadPriorDecisions(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<Array<FindingIdentity & { decision: PriorDecision }>> {
  const runs = await db
    .select({ id: matchRuns.id })
    .from(matchRuns)
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId)));
  if (runs.length === 0) return [];
  const rows = await db
    .select({
      type: discrepancies.type,
      invoiceLineId: discrepancies.invoiceLineId,
      poLineId: discrepancies.poLineId,
      productId: discrepancies.productId,
      deltaAmount: discrepancies.deltaAmount,
      expected: discrepancies.expectedValue,
      actual: discrepancies.actualValue,
      resolutionStatus: discrepancies.resolutionStatus,
      resolvedBy: discrepancies.resolvedBy,
      resolvedAt: discrepancies.resolvedAt,
      resolutionNote: discrepancies.resolutionNote,
      requiresRole: discrepancies.requiresRole,
    })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        inArray(
          discrepancies.matchRunId,
          runs.map((r) => r.id),
        ),
        or(isNotNull(discrepancies.resolvedAt), eq(discrepancies.resolutionStatus, 'escalated')),
      ),
    );
  return rows.map((r) => ({
    type: r.type,
    invoiceLineId: r.invoiceLineId,
    poLineId: r.poLineId,
    productId: r.productId,
    deltaAmount: r.deltaAmount,
    expected: r.expected,
    actual: r.actual,
    decision: {
      resolutionStatus: r.resolutionStatus,
      resolvedBy: r.resolvedBy,
      resolvedAt: r.resolvedAt,
      resolutionNote: r.resolutionNote,
      requiresRole: r.requiresRole,
    },
  }));
}

/**
 * The feed's story for a match, on the SAME rule as the dashboard hero
 * (packages/charts LEAK_FILTER + per-invoice cap): leak = Σ|delta| of warn/block
 * findings, not PRICE_LOWER (an under-charge), not UNORDERED_ARRIVAL (no PO yet
 * — "pending", calm) and not a duplicate a person rejected; capped at the
 * invoice total. So a no-PO invoice reads "ממתינה לשיוך להזמנה", not "הפסד
 * פוטנציאלי ₪1,273" while the hero calls it pending; a clean match reads "תואמת
 * להזמנה ולקבלה", never "0 חריגות · ₪0". Shared by persistMatchRun and the seed.
 */
export function matchActivitySummary(
  findings: { type: string; severity: string; deltaAmount: number; resolutionStatus: string }[],
  invoiceTotalInclVat: number,
): { detail: string; leakCount: number; leakIls: number; pendingLink: boolean } {
  const pendingLink = findings.some(
    (f) => f.type === 'UNORDERED_ARRIVAL' && (f.resolutionStatus === 'open' || f.resolutionStatus === 'escalated'),
  );
  const leaking = findings.filter(
    (f) =>
      (f.severity === 'warn' || f.severity === 'block') &&
      f.type !== 'PRICE_LOWER' &&
      f.type !== 'UNORDERED_ARRIVAL' &&
      !(f.type === 'DUPLICATE_INVOICE' && f.resolutionStatus === 'rejected') &&
      Math.abs(f.deltaAmount) > 0,
  );
  const raw = leaking.reduce((sum, f) => sum + Math.round(Math.abs(f.deltaAmount) * 100), 0) / 100;
  const leakIls = Math.min(raw, Math.max(invoiceTotalInclVat, 0));
  const detail = pendingLink
    ? 'ממתינה לשיוך להזמנה'
    : leaking.length === 0
      ? 'תואמת להזמנה ולקבלה'
      : `${leaking.length === 1 ? 'חריגה אחת' : `${leaking.length} חריגות`} · הפסד פוטנציאלי ₪${Math.round(leakIls).toLocaleString('he-IL')}`;
  return { detail, leakCount: leaking.length, leakIls, pendingLink };
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
  priorDecisions?: Array<FindingIdentity & { decision: PriorDecision }>,
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
  const feedFindings: Parameters<typeof matchActivitySummary>[0] = [];

  const carried = pairPriorDecisions(
    priorDecisions ?? [],
    result.discrepancies.map((d) => ({
      type: d.type,
      invoiceLineId: d.invoiceLineId ?? null,
      poLineId: d.poLineId ?? null,
      productId: d.productId,
      deltaAmount: d.deltaAmount,
      expected: d.expected ?? null,
      actual: d.actual ?? null,
    })),
  );
  for (const [index, d] of result.discrepancies.entries()) {
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
    const prior = carried[index];

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
      requiresRole: prior?.requiresRole ?? decision.requiredRole,
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      resolutionStatus: prior?.resolutionStatus ?? initialStatus,
      resolvedBy: prior?.resolvedBy ?? null,
      resolvedAt: prior?.resolvedAt ?? null,
      resolutionNote: prior?.resolutionNote ?? null,
    });

    feedFindings.push({
      type: d.type,
      severity: d.severity,
      deltaAmount: d.deltaAmount,
      resolutionStatus: prior?.resolutionStatus ?? initialStatus,
    });

    if (!prior && decision.requiredRole && decision.action !== 'auto_approve') {
      rolesNeedingNotification.add(decision.requiredRole);
    }
  }

  // A re-match never moves an invoice back out of `approved` / `paid` — those
  // are people's (payment) decisions. Re-matching a paid invoice used to reset it
  // to `matched`, so its leak reappeared as "caught before payment".
  const finalInvoiceStatus = result.status === 'blocked' ? 'disputed' : 'matched';
  await db
    .update(invoices)
    .set({ status: finalInvoiceStatus })
    .where(
      and(
        eq(invoices.id, args.invoiceId),
        eq(invoices.restaurantId, args.restaurantId),
        ne(invoices.status, 'approved'),
        ne(invoices.status, 'paid'),
      ),
    );

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
  const feed = matchActivitySummary(feedFindings, totalInvoiceAmount);
  await logActivity(db, {
    restaurantId: args.restaurantId,
    eventType: 'invoice_matched',
    title: meta?.invoiceNumber ? `חשבונית ${meta.invoiceNumber} הותאמה` : 'חשבונית הותאמה',
    detail: [meta?.supplierName ?? null, feed.detail].filter(Boolean).join(' · '),
    entityType: 'match_run',
    entityId: matchRun.id,
    metadata: {
      invoiceId: args.invoiceId,
      invoiceNumber: meta?.invoiceNumber ?? null,
      supplierName: meta?.supplierName ?? null,
      supplierNameEn: meta?.supplierNameEn ?? null,
      // Engine totals (all findings) — kept for consumers of the raw numbers.
      discrepancyCount: result.discrepancies.length,
      potentialLossIls: result.totalDiscrepancyAmount,
      // What the feed tells: the hero's leak rule (matchActivitySummary).
      leakCount: feed.leakCount,
      leakIls: feed.leakIls,
      pendingLink: feed.pendingLink,
      status: result.status,
    },
  });

  return {
    matchRunId: matchRun.id,
    rolesNeedingNotification: [...rolesNeedingNotification],
    discrepancyCount: result.discrepancies.length,
  };
}
