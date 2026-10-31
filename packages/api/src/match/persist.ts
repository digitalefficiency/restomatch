import {
  activityEvents,
  and,
  auditLog,
  desc,
  discrepancies,
  eq,
  inArray,
  invoices,
  isNotNull,
  memberships,
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
import { canActOn } from '../lib/roles';
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
  /** What was decided on — the decision only carries to an equivalent finding (decisionStillApplies). */
  severity: string;
  deltaAmount: number;
  /** The decider's role in this restaurant (escalations: the owner they were handed to). */
  deciderRole: UserRole | null;
  /** DUPLICATE_INVOICE: supplier|normalized number it matched (the prior run's feed metadata). */
  duplicateKey?: string | null;
  /**
   * Escalation provenance (W2-13, deep-fix class 14): who handed the finding to the owner
   * and from which role. Read from the escalation's audit row; carried onto the new
   * finding across a re-match so the escalator still sees it as "waiting for the owner".
   */
  escalatedBy?: string | null;
  fromRole?: UserRole | null;
}

/**
 * Does a person's decision still apply to the new run's version of the finding?
 * Only when nothing material changed: same severity, the ₪ did not grow, the
 * decider may still act on where it is routed now (canActOn — what
 * approvals.ensureCanAct enforces), and for a duplicate the same number /
 * supplier it matched. A rejected PRICE_HIGHER warn ₪50 that comes back as a
 * block ₪650 routed to the owner starts fresh — open, routed, notified — rather
 * than staying "rejected" with a manager's note in nobody's queue.
 */
export function decisionStillApplies(
  prior: PriorDecision,
  next: { type: string; severity: string; deltaAmount: number; requiredRole: UserRole | null; duplicateKey?: string | null },
): boolean {
  if (prior.severity !== next.severity) return false;
  if (Math.round(Math.abs(next.deltaAmount) * 100) > Math.round(Math.abs(prior.deltaAmount) * 100)) return false;
  if (prior.resolutionStatus !== 'escalated') {
    // Routing must not have become stricter than what the decision covered: the
    // decider may act on the new routing, or it is the same routing it was
    // decided under (decided, by definition, by someone allowed to then).
    const sameRouting = prior.requiresRole === next.requiredRole;
    const deciderMayAct = !!prior.deciderRole && canActOn(prior.deciderRole, next.requiredRole);
    if (!sameRouting && !deciderMayAct) return false;
  }
  if (next.type === 'DUPLICATE_INVOICE') {
    if (!prior.duplicateKey || prior.duplicateKey !== next.duplicateKey) return false;
  }
  return true;
}

/** The identity a duplicate finding matched: the supplier + the (normalized) number. */
export const duplicateKeyOf = (input: MatchInput) => `${input.invoice.supplierId}|${input.invoice.invoiceNumber}`;

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
      id: discrepancies.id,
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
      severity: discrepancies.severity,
      matchRunId: discrepancies.matchRunId,
      deciderRole: memberships.role,
    })
    .from(discrepancies)
    .leftJoin(
      memberships,
      and(eq(memberships.userId, discrepancies.resolvedBy), eq(memberships.restaurantId, restaurantId)),
    )
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
  // The number / supplier each prior run's duplicate matched (written in its feed row).
  const feed = await db
    .select({ entityId: activityEvents.entityId, metadata: activityEvents.metadata })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.restaurantId, restaurantId),
        eq(activityEvents.eventType, 'invoice_matched'),
        inArray(
          activityEvents.entityId,
          runs.map((r) => r.id),
        ),
      ),
    );
  // Escalation provenance: the latest `discrepancy.escalated` audit row of each escalated finding.
  const escalatedIds = rows.filter((r) => r.resolutionStatus === 'escalated').map((r) => r.id);
  const escalations =
    escalatedIds.length === 0
      ? []
      : await db
          .select({ entityId: auditLog.entityId, userId: auditLog.userId, after: auditLog.after })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.restaurantId, restaurantId),
              eq(auditLog.entityType, 'discrepancy'),
              eq(auditLog.action, 'discrepancy.escalated'),
              inArray(auditLog.entityId, escalatedIds),
            ),
          )
          .orderBy(desc(auditLog.at));
  const escalationOf = new Map<string, { escalatedBy: string | null; fromRole: UserRole | null }>();
  for (const e of escalations) {
    if (!e.entityId || escalationOf.has(e.entityId)) continue; // newest first
    const after = (e.after ?? {}) as { fromRole?: unknown; escalatedBy?: unknown };
    escalationOf.set(e.entityId, {
      escalatedBy: typeof after.escalatedBy === 'string' ? after.escalatedBy : (e.userId ?? null),
      fromRole: typeof after.fromRole === 'string' ? (after.fromRole as UserRole) : null,
    });
  }
  const dupKeyByRun = new Map(
    feed.map((f) => [f.entityId, typeof f.metadata?.duplicateKey === 'string' ? (f.metadata.duplicateKey as string) : null]),
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
      severity: r.severity,
      deltaAmount: Number(r.deltaAmount ?? 0),
      deciderRole: r.resolutionStatus === 'escalated' ? 'owner' : (r.deciderRole ?? null),
      duplicateKey: dupKeyByRun.get(r.matchRunId) ?? null,
      ...(r.resolutionStatus === 'escalated'
        ? { escalatedBy: escalationOf.get(r.id)?.escalatedBy ?? null, fromRole: escalationOf.get(r.id)?.fromRole ?? null }
        : {}),
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
  /** Was the invoice checked against a PO? (persist: input.poLines.length > 0). */
  opts: { poMatched?: boolean } = {},
): { detail: string; leakCount: number; leakIls: number; pendingLink: boolean; poMatched: boolean; reviewCount: number } {
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
  const poMatched = opts.poMatched ?? !findings.some((f) => f.type === 'UNORDERED_ARRIVAL');
  // Findings still waiting for a person that are not a loss (e.g. a date anomaly,
  // an under-charge to confirm): "to review", not "matches".
  const reviewCount = findings.filter(
    (f) =>
      (f.severity === 'warn' || f.severity === 'block') &&
      (f.resolutionStatus === 'open' || f.resolutionStatus === 'escalated') &&
      f.type !== 'UNORDERED_ARRIVAL' &&
      !leaking.includes(f),
  ).length;
  // Worded from the actual findings: the PO state first, then the loss, then
  // anything left to check — "matches" only when there was a PO and nothing is open.
  const parts: string[] = [];
  if (!poMatched) parts.push(pendingLink ? 'ממתינה לשיוך להזמנה' : 'ללא הזמנה מקושרת');
  if (leaking.length > 0) {
    parts.push(leaking.length === 1 ? 'חריגה אחת' : `${leaking.length} חריגות`);
    parts.push(`הפסד פוטנציאלי ₪${Math.round(leakIls).toLocaleString('he-IL')}`);
  } else if (reviewCount > 0) {
    parts.push(reviewCount === 1 ? 'חריגה אחת לבדיקה' : `${reviewCount} חריגות לבדיקה`);
  } else if (poMatched) {
    parts.push('תואמת להזמנה ולקבלה');
  }
  return { detail: parts.join(' · '), leakCount: leaking.length, leakIls, pendingLink, poMatched, reviewCount };
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
      expected: d.type === 'DATE_ANOMALY' ? null : (d.expected ?? null),
      actual: d.type === 'DATE_ANOMALY' ? null : (d.actual ?? null),
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
    const paired = carried[index];
    const prior =
      paired &&
      decisionStillApplies(paired, {
        type: d.type,
        severity: d.severity,
        deltaAmount: d.deltaAmount,
        requiredRole: decision.requiredRole,
        duplicateKey: duplicateKeyOf(input),
      })
        ? paired
        : undefined;

    const [inserted] = await db.insert(discrepancies).values({
      matchRunId: matchRun.id,
      restaurantId: args.restaurantId,
      type: d.type,
      severity: d.severity,
      productId: d.productId,
      poLineId: d.poLineId ?? null,
      grLineId: d.grLineId ?? null,
      invoiceLineId: d.invoiceLineId ?? null,
      // DATE_ANOMALY carries epoch-ms dates in expected/actual (engine.ts, immutable)
      // — far past NUMERIC(12,4). Store no number: the dates live on
      // invoices.invoice_date and the matched PO's expected_delivery_at.
      expectedValue: d.type === 'DATE_ANOMALY' ? null : (d.expected?.toString() ?? null),
      actualValue: d.type === 'DATE_ANOMALY' ? null : (d.actual?.toString() ?? null),
      deltaAmount: d.deltaAmount.toString(),
      toleranceUsed: d.toleranceUsed,
      requiresRole: prior?.requiresRole ?? decision.requiredRole,
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      resolutionStatus: prior?.resolutionStatus ?? initialStatus,
      resolvedBy: prior?.resolvedBy ?? null,
      resolvedAt: prior?.resolvedAt ?? null,
      resolutionNote: prior?.resolutionNote ?? null,
    }).returning({ id: discrepancies.id });

    // A carried escalation keeps its provenance on the new finding (W2-13): the audit row
    // names who escalated and from which role, marked `carried` (no new human action).
    if (prior?.resolutionStatus === 'escalated' && inserted && (prior.escalatedBy || prior.fromRole)) {
      await db.insert(auditLog).values({
        restaurantId: args.restaurantId,
        userId: prior.escalatedBy ?? null,
        action: 'discrepancy.escalated',
        entityType: 'discrepancy',
        entityId: inserted.id,
        before: null,
        after: {
          status: 'escalated',
          note: prior.resolutionNote ?? null,
          fromRole: prior.fromRole ?? null,
          escalatedBy: prior.escalatedBy ?? null,
          carried: true,
          matchRunId: matchRun.id,
        },
      });
    }

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

  // Activity entry, v2 (W2-13): structured metadata only. The title is a machine key
  // (the column is NOT NULL), `detail` is null; no ₪ and no Hebrew are baked in.
  // Every locale renders the row from the metadata (apps/web activityText).
  const [meta] = await db
    .select({ invoiceNumber: invoices.invoiceNumber, supplierName: suppliers.name, supplierNameEn: suppliers.nameEn })
    .from(invoices)
    .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, args.restaurantId)))
    .where(and(eq(invoices.id, args.invoiceId), eq(invoices.restaurantId, args.restaurantId)))
    .limit(1);
  const feed = matchActivitySummary(feedFindings, totalInvoiceAmount, { poMatched: input.poLines.length > 0 });
  await logActivity(db, {
    restaurantId: args.restaurantId,
    eventType: 'invoice_matched',
    title: `invoice_matched:${meta?.invoiceNumber ?? args.invoiceId}`,
    detail: null,
    entityType: 'match_run',
    entityId: matchRun.id,
    metadata: {
      v: 2,
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
      leakAgorot: Math.round(feed.leakIls * 100),
      pendingLink: feed.pendingLink,
      poMatched: feed.poMatched,
      reviewCount: feed.reviewCount,
      // What a duplicate matched, so a re-match can tell "same duplicate" (keep the decision) from a new one.
      ...(result.discrepancies.some((d) => d.type === 'DUPLICATE_INVOICE') ? { duplicateKey: duplicateKeyOf(input) } : {}),
      status: result.status,
    },
  });

  return {
    matchRunId: matchRun.id,
    rolesNeedingNotification: [...rolesNeedingNotification],
    discrepancyCount: result.discrepancies.length,
  };
}
