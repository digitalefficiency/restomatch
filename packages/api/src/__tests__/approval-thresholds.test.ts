import { describe, expect, it } from 'vitest';
import {
  buildRules,
  evaluateApproval,
  resolveApprovalThresholds,
  type ApprovalContext,
} from '../approvals/engine';

// A ₪200 cumulative discrepancy on a ₪10,000 invoice = 2% — lands in the
// "medium" band by default, but a restaurant can pull the "large" threshold
// down to escalate it.
const ctx: ApprovalContext = {
  discrepancy: { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 200 },
  matchRun: { totalDiscrepancyAmount: 200, totalInvoiceAmount: 10000, poExists: true },
};

describe('per-restaurant approval thresholds', () => {
  it('default thresholds route a ₪200 / 2% cumulative discrepancy to the manager', () => {
    const decision = evaluateApproval(ctx, buildRules());
    expect(decision.requiredRole).toBe('manager');
    expect(decision.action).toBe('queue_review');
  });

  it('a lower large-cumulative threshold escalates the same case to the owner', () => {
    const rules = buildRules(resolveApprovalThresholds({ cumulativeLargeAmount: 150 }));
    const decision = evaluateApproval(ctx, rules);
    expect(decision.requiredRole).toBe('owner');
    expect(decision.action).toBe('queue_review');
  });

  it('resolveApprovalThresholds ignores undefined and merges over defaults', () => {
    const t = resolveApprovalThresholds({
      cumulativeLargeAmount: 150,
      largeInvoiceWithoutPo: undefined,
    });
    expect(t.cumulativeLargeAmount).toBe(150);
    expect(t.largeInvoiceWithoutPo).toBe(5000);
  });
});
