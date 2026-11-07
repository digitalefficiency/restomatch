/**
 * Approval routing engine — pure function.
 *
 * Given a discrepancy and the surrounding match-run context, returns
 * the role that must approve and the action to take (auto-approve,
 * queue for review, block, or notify only).
 *
 * Implements the 6 default rules from plan §7. Restaurant-specific
 * overrides are applied on top of the defaults when present.
 *
 * G-15: a row the leak does not count (LEAK_FILTER, packages/charts) is
 * acknowledged with no ₪ (`non-leak-acknowledge`) before the cumulative
 * rules — no owner queue entry, no "דרוש ₪X", for a row that is not
 * claimable. `evaluatePayApproval` is the pay-approval rule (decision 9).
 */

import type { UserRole } from '@restomatch/db';

export type ApprovalAction = 'auto_approve' | 'queue_review' | 'block' | 'notify';

export type DiscrepancyType =
  | 'PRICE_HIGHER'
  | 'PRICE_LOWER'
  | 'QTY_SHORT'
  | 'QTY_OVER'
  | 'UNORDERED_ITEM'
  | 'MISSING_ON_INVOICE'
  | 'UNIT_MISMATCH'
  | 'UNORDERED_ARRIVAL'
  | 'DUPLICATE_INVOICE'
  | 'DATE_ANOMALY'
  | 'VAT_MISMATCH'
  | 'TOTAL_MISMATCH';

export type Severity = 'info' | 'warn' | 'block';

export interface ApprovalContext {
  discrepancy: {
    type: DiscrepancyType;
    severity: Severity;
    deltaAmount: number;
  };
  matchRun: {
    totalDiscrepancyAmount: number;
    totalInvoiceAmount: number;
    poExists: boolean;
  };
}

export interface ApprovalDecision {
  requiredRole: UserRole | null;
  action: ApprovalAction;
  ruleId: string;
  ruleName: string;
}

interface Rule {
  id: string;
  name: string;
  priority: number;
  predicate: (ctx: ApprovalContext) => boolean;
  decision: { requiredRole: UserRole | null; action: ApprovalAction };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Per-restaurant approval thresholds
 *
 * The default rules embed money/percent thresholds. These are tunable per
 * restaurant via `restaurants.settings.approvalThresholds` — `buildRules()`
 * substitutes them so the per-tenant routing config is live, not hardcoded.
 * ────────────────────────────────────────────────────────────────────────── */

export interface ApprovalThresholds {
  /** Invoice without any PO above this amount → owner blocks. */
  largeInvoiceWithoutPo?: number;
  /** Unordered item with delta above this → owner blocks. */
  unorderedItemSignificant?: number;
  /** Cumulative discrepancy amount (or pct) above this → owner queue. */
  cumulativeLargeAmount?: number;
  cumulativeLargePct?: number;
  /** Cumulative amount (or pct) above this, up to the large band → manager queue. */
  cumulativeMediumAmountMin?: number;
  cumulativeMediumPctMin?: number;
}

export const DEFAULT_APPROVAL_THRESHOLDS: Required<ApprovalThresholds> = {
  largeInvoiceWithoutPo: 5000,
  unorderedItemSignificant: 100,
  cumulativeLargeAmount: 300,
  cumulativeLargePct: 0.05,
  cumulativeMediumAmountMin: 50,
  cumulativeMediumPctMin: 0.02,
};

/** Merge a restaurant's partial threshold overrides over the defaults. */
export function resolveApprovalThresholds(
  overrides?: Partial<ApprovalThresholds> | null,
): Required<ApprovalThresholds> {
  const clean: Partial<ApprovalThresholds> = {};
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null) {
        (clean as Record<string, number>)[key] = value as number;
      }
    }
  }
  return { ...DEFAULT_APPROVAL_THRESHOLDS, ...clean };
}

/**
 * Does this row count in the leak? The routing-time part of the charts
 * LEAK_FILTER (packages/charts/src/leak-views.ts) as of train-B #211:
 *   severity IN ('warn','block') AND type NOT IN LEAK_EXCLUDED_TYPES
 *   (PRICE_LOWER, UNORDERED_ARRIVAL, MISSING_ON_INVOICE — owner decision 31.10:
 *   an ordered line the invoice never billed is not claimable and not leak).
 * TODO(G-15, after #211 merges): import LEAK_EXCLUDED_TYPES from @restomatch/charts.
 * The filter's third clause (a duplicate the user REJECTED) is a decision,
 * not a routing input — a fresh row is never rejected. Parity is tested in
 * approvals-engine-routing.test.ts.
 */
export const NON_LEAK_TYPES: ReadonlySet<DiscrepancyType> = new Set([
  'PRICE_LOWER',
  'UNORDERED_ARRIVAL',
  'MISSING_ON_INVOICE',
]);
export function countsAsLeak(d: { type: DiscrepancyType; severity: Severity }): boolean {
  return (d.severity === 'warn' || d.severity === 'block') && !NON_LEAK_TYPES.has(d.type);
}

function discrepancyPct(ctx: ApprovalContext): number {
  return ctx.matchRun.totalInvoiceAmount > 0
    ? ctx.matchRun.totalDiscrepancyAmount / ctx.matchRun.totalInvoiceAmount
    : 0;
}

/**
 * Build the rule set (priority DESC, highest fires first) with the given
 * thresholds substituted. `DEFAULT_RULES` is `buildRules()` with defaults.
 */
export function buildRules(t: Required<ApprovalThresholds> = DEFAULT_APPROVAL_THRESHOLDS): Rule[] {
  return [
    {
      id: 'duplicate-invoice',
      name: 'חשבונית כפולה — חסימת תשלום',
      priority: 100,
      predicate: (ctx) => ctx.discrepancy.type === 'DUPLICATE_INVOICE',
      decision: { requiredRole: 'bookkeeper', action: 'block' },
    },
    {
      id: 'large-invoice-without-po',
      name: `חשבונית מעל ₪${t.largeInvoiceWithoutPo.toLocaleString('he-IL')} ללא PO`,
      priority: 95,
      predicate: (ctx) =>
        ctx.discrepancy.type === 'UNORDERED_ARRIVAL' &&
        ctx.matchRun.totalInvoiceAmount > t.largeInvoiceWithoutPo,
      decision: { requiredRole: 'owner', action: 'block' },
    },
    {
      id: 'unordered-item-significant',
      name: `פריט שלא הוזמן מעל ₪${t.unorderedItemSignificant.toLocaleString('he-IL')}`,
      priority: 90,
      predicate: (ctx) =>
        ctx.discrepancy.type === 'UNORDERED_ITEM' &&
        ctx.discrepancy.deltaAmount > t.unorderedItemSignificant,
      decision: { requiredRole: 'owner', action: 'block' },
    },
    {
      id: 'severity-block',
      name: 'חומרה גבוהה — אישור בעלים',
      priority: 80,
      predicate: (ctx) => ctx.discrepancy.severity === 'block',
      decision: { requiredRole: 'owner', action: 'block' },
    },
    {
      // Below every control (duplicate, no-PO, unordered, severity-block),
      // above the cumulative ₪ rules: a non-leak row never inherits the
      // invoice's cumulative ₪ and never waits in a ₪ queue.
      id: 'non-leak-acknowledge',
      name: 'פער ללא ₪ לדליפה — נרשם לידיעה',
      priority: 75,
      predicate: (ctx) => !countsAsLeak(ctx.discrepancy),
      decision: { requiredRole: null, action: 'auto_approve' },
    },
    {
      id: 'cumulative-large',
      name: `הפרש מצטבר מעל ${t.cumulativeLargePct * 100}% או ₪${t.cumulativeLargeAmount}`,
      priority: 70,
      predicate: (ctx) =>
        discrepancyPct(ctx) > t.cumulativeLargePct ||
        ctx.matchRun.totalDiscrepancyAmount > t.cumulativeLargeAmount,
      decision: { requiredRole: 'owner', action: 'queue_review' },
    },
    {
      id: 'cumulative-medium',
      name: `הפרש מצטבר ${t.cumulativeMediumPctMin * 100}-${t.cumulativeLargePct * 100}% או ₪${t.cumulativeMediumAmountMin}-${t.cumulativeLargeAmount}`,
      priority: 60,
      predicate: (ctx) => {
        const pct = discrepancyPct(ctx);
        return (
          (pct > t.cumulativeMediumPctMin && pct <= t.cumulativeLargePct) ||
          (ctx.matchRun.totalDiscrepancyAmount > t.cumulativeMediumAmountMin &&
            ctx.matchRun.totalDiscrepancyAmount <= t.cumulativeLargeAmount)
        );
      },
      decision: { requiredRole: 'manager', action: 'queue_review' },
    },
    {
      id: 'minor-info',
      name: 'הפרש זניח (≤2%, info)',
      priority: 10,
      predicate: (ctx) => ctx.discrepancy.severity === 'info',
      decision: { requiredRole: null, action: 'auto_approve' },
    },
  ];
}

export const DEFAULT_RULES: Rule[] = buildRules();

/* ──────────────────────────────────────────────────────────────────────────
 * Evaluator
 *
 * Iterates rules in priority DESC and returns the first match.
 * Falls back to manager queue if nothing matches.
 * ────────────────────────────────────────────────────────────────────────── */

export function evaluateApproval(
  ctx: ApprovalContext,
  rules: Rule[] = DEFAULT_RULES,
): ApprovalDecision {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.predicate(ctx)) {
      return {
        requiredRole: rule.decision.requiredRole,
        action: rule.decision.action,
        ruleId: rule.id,
        ruleName: rule.name,
      };
    }
  }
  // Fallback — never auto-approve without explicit rule
  return {
    requiredRole: 'manager',
    action: 'queue_review',
    ruleId: 'fallback',
    ruleName: 'ברירת מחדל: ניתוב למנהל',
  };
}

/** Helper used by callers — pretty-prints the decision for audit logs. */
export function decisionMessage(decision: ApprovalDecision): string {
  const role = decision.requiredRole ?? 'system';
  return `${decision.ruleName} → ${role} (${decision.action})`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Pay-approval rule (owner decision 9 / G-15)
 *
 * "Over ₪N, or a new supplier → the owner approves for payment." Pure; the
 * thresholds are READ from `restaurants.settings.approvalThresholds`
 * (`payApprovalOverAmount`, `newSupplierInvoiceCount`) — no write path is
 * added here. W2-03's `approve_for_payment` calls it.
 * ────────────────────────────────────────────────────────────────────────── */

export interface PayApprovalThresholds {
  /** Invoice total incl. VAT strictly above this (₪) → owner approves for payment. */
  payApprovalOverAmount: number;
  /** A supplier with fewer than this many prior invoices is "new" → owner. */
  newSupplierInvoiceCount: number;
}

/** Defaults pending the owner's N (decision 9): ₪5,000, and a supplier's first invoice. */
export const DEFAULT_PAY_APPROVAL_THRESHOLDS: PayApprovalThresholds = {
  payApprovalOverAmount: 5000,
  newSupplierInvoiceCount: 1,
};

/** Read the pay-approval thresholds from a restaurant's approvalThresholds (unknown keys ignored). */
export function resolvePayApprovalThresholds(settings?: Record<string, unknown> | null): PayApprovalThresholds {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    payApprovalOverAmount: num(settings?.payApprovalOverAmount) ?? DEFAULT_PAY_APPROVAL_THRESHOLDS.payApprovalOverAmount,
    newSupplierInvoiceCount:
      num(settings?.newSupplierInvoiceCount) ?? DEFAULT_PAY_APPROVAL_THRESHOLDS.newSupplierInvoiceCount,
  };
}

export type PayApprovalReason = 'over_amount' | 'new_supplier';

export interface PayApprovalDecision {
  /** true → only the owner may approve this invoice for payment. */
  requiresOwner: boolean;
  requiredRole: UserRole | null;
  reasons: PayApprovalReason[];
}

export function evaluatePayApproval(
  invoice: { totalInclVat: number; supplierPriorInvoices: number },
  t: PayApprovalThresholds = DEFAULT_PAY_APPROVAL_THRESHOLDS,
): PayApprovalDecision {
  const reasons: PayApprovalReason[] = [];
  // Compared in agorot so ₪5,000.00 is not "over" ₪5,000.
  if (Math.round(invoice.totalInclVat * 100) > Math.round(t.payApprovalOverAmount * 100)) reasons.push('over_amount');
  if (invoice.supplierPriorInvoices < t.newSupplierInvoiceCount) reasons.push('new_supplier');
  const requiresOwner = reasons.length > 0;
  return { requiresOwner, requiredRole: requiresOwner ? 'owner' : null, reasons };
}
