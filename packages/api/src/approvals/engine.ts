/**
 * Approval routing engine — pure function.
 *
 * Given a discrepancy and the surrounding match-run context, returns
 * the role that must approve and the action to take (auto-approve,
 * queue for review, block, or notify only).
 *
 * Implements the 6 default rules from plan §7. Restaurant-specific
 * overrides are applied on top of the defaults when present.
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
 * Default rules (from plan §7, sorted by priority — highest fires first)
 * ────────────────────────────────────────────────────────────────────────── */

export const DEFAULT_RULES: Rule[] = [
  {
    id: 'duplicate-invoice',
    name: 'חשבונית כפולה — חסימת תשלום',
    priority: 100,
    predicate: (ctx) => ctx.discrepancy.type === 'DUPLICATE_INVOICE',
    decision: { requiredRole: 'bookkeeper', action: 'block' },
  },
  {
    id: 'large-invoice-without-po',
    name: 'חשבונית מעל ₪5,000 ללא PO',
    priority: 95,
    predicate: (ctx) =>
      ctx.discrepancy.type === 'UNORDERED_ARRIVAL' && ctx.matchRun.totalInvoiceAmount > 5000,
    decision: { requiredRole: 'owner', action: 'block' },
  },
  {
    id: 'unordered-item-significant',
    name: 'פריט שלא הוזמן מעל ₪100',
    priority: 90,
    predicate: (ctx) =>
      ctx.discrepancy.type === 'UNORDERED_ITEM' && ctx.discrepancy.deltaAmount > 100,
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
    id: 'cumulative-large',
    name: 'הפרש מצטבר מעל 5% או ₪300',
    priority: 70,
    predicate: (ctx) => {
      const pct =
        ctx.matchRun.totalInvoiceAmount > 0
          ? ctx.matchRun.totalDiscrepancyAmount / ctx.matchRun.totalInvoiceAmount
          : 0;
      return pct > 0.05 || ctx.matchRun.totalDiscrepancyAmount > 300;
    },
    decision: { requiredRole: 'owner', action: 'queue_review' },
  },
  {
    id: 'cumulative-medium',
    name: 'הפרש מצטבר 2-5% או ₪50-300',
    priority: 60,
    predicate: (ctx) => {
      const pct =
        ctx.matchRun.totalInvoiceAmount > 0
          ? ctx.matchRun.totalDiscrepancyAmount / ctx.matchRun.totalInvoiceAmount
          : 0;
      return (
        (pct > 0.02 && pct <= 0.05) ||
        (ctx.matchRun.totalDiscrepancyAmount > 50 && ctx.matchRun.totalDiscrepancyAmount <= 300)
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
