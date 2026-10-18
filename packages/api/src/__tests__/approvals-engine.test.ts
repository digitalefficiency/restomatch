import { describe, expect, it } from 'vitest';
import { evaluateApproval, type ApprovalContext } from '../approvals/engine';

interface CtxOverrides {
  discrepancy?: Partial<ApprovalContext['discrepancy']>;
  matchRun?: Partial<ApprovalContext['matchRun']>;
}

function ctx(overrides: CtxOverrides = {}): ApprovalContext {
  return {
    discrepancy: {
      type: 'PRICE_HIGHER',
      severity: 'warn',
      deltaAmount: 50,
      ...overrides.discrepancy,
    },
    matchRun: {
      totalDiscrepancyAmount: 50,
      totalInvoiceAmount: 1000,
      poExists: true,
      ...overrides.matchRun,
    },
  };
}

describe('evaluateApproval — default rules', () => {
  it('DUPLICATE_INVOICE → bookkeeper + block', () => {
    const decision = evaluateApproval(
      ctx({ discrepancy: { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: 3000 } }),
    );
    expect(decision.requiredRole).toBe('bookkeeper');
    expect(decision.action).toBe('block');
    expect(decision.ruleId).toBe('duplicate-invoice');
  });

  it('UNORDERED_ARRIVAL with invoice > ₪5,000 → owner + block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ARRIVAL', severity: 'block', deltaAmount: 6000 },
        matchRun: { totalInvoiceAmount: 6000 },
      }),
    );
    expect(decision.requiredRole).toBe('owner');
    expect(decision.action).toBe('block');
    expect(decision.ruleId).toBe('large-invoice-without-po');
  });

  it('UNORDERED_ARRIVAL with invoice ≤ ₪5,000 → falls through to severity-block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ARRIVAL', severity: 'block', deltaAmount: 200 },
        matchRun: { totalInvoiceAmount: 4000 },
      }),
    );
    expect(decision.ruleId).toBe('severity-block');
    expect(decision.requiredRole).toBe('owner');
  });

  it('UNORDERED_ITEM with deltaAmount > ₪100 → owner + block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ITEM', severity: 'block', deltaAmount: 150 },
      }),
    );
    expect(decision.ruleId).toBe('unordered-item-significant');
    expect(decision.requiredRole).toBe('owner');
  });

  it('UNORDERED_ITEM with small deltaAmount → falls to severity-block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ITEM', severity: 'block', deltaAmount: 80 },
      }),
    );
    expect(decision.ruleId).toBe('severity-block');
  });

  it('any severity=block → owner + block (fallback)', () => {
    const decision = evaluateApproval(
      ctx({ discrepancy: { type: 'TOTAL_MISMATCH', severity: 'block', deltaAmount: 100 } }),
    );
    expect(decision.requiredRole).toBe('owner');
    expect(decision.action).toBe('block');
  });

  it('cumulative > 5% → owner + queue_review', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 30 },
        matchRun: { totalDiscrepancyAmount: 60, totalInvoiceAmount: 1000 }, // 6%
      }),
    );
    expect(decision.requiredRole).toBe('owner');
    expect(decision.action).toBe('queue_review');
    expect(decision.ruleId).toBe('cumulative-large');
  });

  it('cumulative > ₪300 → owner + queue_review', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 100 },
        matchRun: { totalDiscrepancyAmount: 400, totalInvoiceAmount: 10000 }, // 4% but >₪300
      }),
    );
    expect(decision.requiredRole).toBe('owner');
    expect(decision.ruleId).toBe('cumulative-large');
  });

  it('cumulative 2-5% → manager + queue_review', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: 30 },
        matchRun: { totalDiscrepancyAmount: 35, totalInvoiceAmount: 1000 }, // 3.5%
      }),
    );
    expect(decision.requiredRole).toBe('manager');
    expect(decision.action).toBe('queue_review');
    expect(decision.ruleId).toBe('cumulative-medium');
  });

  it('cumulative ₪50-300 → manager', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'QTY_OVER', severity: 'warn', deltaAmount: 60 },
        matchRun: { totalDiscrepancyAmount: 60, totalInvoiceAmount: 100000 }, // tiny %
      }),
    );
    expect(decision.requiredRole).toBe('manager');
    expect(decision.ruleId).toBe('cumulative-medium');
  });

  it('severity=info, no other rules → auto_approve', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'PRICE_LOWER', severity: 'info', deltaAmount: 10 },
        matchRun: { totalDiscrepancyAmount: 10, totalInvoiceAmount: 1000 }, // 1%
      }),
    );
    expect(decision.action).toBe('auto_approve');
    expect(decision.requiredRole).toBeNull();
    expect(decision.ruleId).toBe('minor-info');
  });

  it('warn with no cumulative match → fallback to manager queue', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNIT_MISMATCH', severity: 'warn', deltaAmount: 0 },
        matchRun: { totalDiscrepancyAmount: 0, totalInvoiceAmount: 1000 },
      }),
    );
    expect(decision.requiredRole).toBe('manager');
    expect(decision.action).toBe('queue_review');
  });

  it('priority: duplicate-invoice wins over severity-block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: 3000 },
        matchRun: { totalDiscrepancyAmount: 3000, totalInvoiceAmount: 5000 },
      }),
    );
    expect(decision.ruleId).toBe('duplicate-invoice');
  });

  it('priority: large-invoice rules over severity-block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ARRIVAL', severity: 'block', deltaAmount: 0 },
        matchRun: { totalDiscrepancyAmount: 0, totalInvoiceAmount: 6500 },
      }),
    );
    expect(decision.ruleId).toBe('large-invoice-without-po');
  });

  it('priority: unordered-item-significant wins over severity-block', () => {
    const decision = evaluateApproval(
      ctx({
        discrepancy: { type: 'UNORDERED_ITEM', severity: 'block', deltaAmount: 500 },
      }),
    );
    expect(decision.ruleId).toBe('unordered-item-significant');
  });

  it('custom rules override defaults', () => {
    const customRules = [
      {
        id: 'always-block',
        name: 'חוסם הכל',
        priority: 1000,
        predicate: () => true,
        decision: { requiredRole: 'owner' as const, action: 'block' as const },
      },
    ];
    const decision = evaluateApproval(
      ctx({ discrepancy: { type: 'PRICE_LOWER', severity: 'info', deltaAmount: 1 } }),
      customRules,
    );
    expect(decision.ruleId).toBe('always-block');
  });

  it('empty rule list → fallback', () => {
    const decision = evaluateApproval(ctx({}), []);
    expect(decision.ruleId).toBe('fallback');
    expect(decision.requiredRole).toBe('manager');
  });
});
