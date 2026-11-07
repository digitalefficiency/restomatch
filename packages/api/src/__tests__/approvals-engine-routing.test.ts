import { describe, expect, it } from 'vitest';
import {
  buildRules,
  countsAsLeak,
  DEFAULT_PAY_APPROVAL_THRESHOLDS,
  evaluateApproval,
  evaluatePayApproval,
  resolveApprovalThresholds,
  resolvePayApprovalThresholds,
  type ApprovalContext,
  type DiscrepancyType,
  type Severity,
} from '../approvals/engine';

/**
 * G-15: info-row routing parity with the charts LEAK_FILTER, and the
 * pay-approval rule (decision 9). Pure — no DB.
 */

const TYPES: DiscrepancyType[] = [
  'PRICE_HIGHER',
  'PRICE_LOWER',
  'QTY_SHORT',
  'QTY_OVER',
  'UNORDERED_ITEM',
  'MISSING_ON_INVOICE',
  'UNIT_MISMATCH',
  'UNORDERED_ARRIVAL',
  'DUPLICATE_INVOICE',
  'DATE_ANOMALY',
  'VAT_MISMATCH',
  'TOTAL_MISMATCH',
];
const SEVERITIES: Severity[] = ['info', 'warn', 'block'];

/**
 * The routing-time clauses of LEAK_FILTER (packages/charts/src/leak-views.ts),
 * restated independently, as of train-B #211: severity IN ('warn','block') AND
 * type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL','MISSING_ON_INVOICE'). The third clause (a REJECTED duplicate)
 * needs a decision, which a freshly routed row never has.
 */
function leakFilterAtRouting(type: DiscrepancyType, severity: Severity): boolean {
  return ['warn', 'block'].includes(severity) && !['PRICE_LOWER', 'UNORDERED_ARRIVAL', 'MISSING_ON_INVOICE'].includes(type);
}

// A run big enough that every cumulative rule would fire (₪950 on ₪1,000).
const bigRun = { totalDiscrepancyAmount: 950, totalInvoiceAmount: 1000, poExists: true };
const ctx = (type: DiscrepancyType, severity: Severity, deltaAmount = 95.23): ApprovalContext => ({
  discrepancy: { type, severity, deltaAmount },
  matchRun: bigRun,
});

const CONTROL_RULES = new Set(['duplicate-invoice', 'large-invoice-without-po', 'unordered-item-significant', 'severity-block']);

describe('countsAsLeak ≡ LEAK_FILTER at routing time', () => {
  for (const type of TYPES) {
    for (const severity of SEVERITIES) {
      it(`${type}/${severity}`, () => {
        expect(countsAsLeak({ type, severity })).toBe(leakFilterAtRouting(type, severity));
      });
    }
  }
});

describe('non-leak rows are acknowledged with no ₪, before the cumulative rules', () => {
  for (const type of TYPES) {
    for (const severity of SEVERITIES) {
      it(`${type}/${severity} on a ₪950 run`, () => {
        const d = evaluateApproval(ctx(type, severity));
        if (leakFilterAtRouting(type, severity)) {
          expect(d.ruleId).not.toBe('non-leak-acknowledge');
          return;
        }
        // A non-leak row is either stopped by a control rule (duplicate,
        // no-PO, unordered, severity-block) or acknowledged — never a
        // cumulative ₪ queue and never the manager fallback.
        expect(['cumulative-large', 'cumulative-medium', 'fallback']).not.toContain(d.ruleId);
        if (!CONTROL_RULES.has(d.ruleId)) {
          expect(d.ruleId).toBe('non-leak-acknowledge');
          expect(d.action).toBe('auto_approve');
          expect(d.requiredRole).toBeNull();
        }
      });
    }
  }

  it('the info QTY_SHORT that used to sit in the owner queue at ₪95.23 is acknowledged', () => {
    const d = evaluateApproval(ctx('QTY_SHORT', 'info'));
    expect(d).toMatchObject({ ruleId: 'non-leak-acknowledge', action: 'auto_approve', requiredRole: null });
  });

  it('controls are unchanged: no-PO invoice over ₪5,000 still blocks for the owner', () => {
    const d = evaluateApproval({
      discrepancy: { type: 'UNORDERED_ARRIVAL', severity: 'block', deltaAmount: 6000 },
      matchRun: { totalDiscrepancyAmount: 6000, totalInvoiceAmount: 6000, poExists: false },
    });
    expect(d).toMatchObject({ ruleId: 'large-invoice-without-po', action: 'block', requiredRole: 'owner' });
  });

  it('MISSING_ON_INVOICE (decision 31.10) is acknowledged, never a ₪ queue', () => {
    expect(evaluateApproval(ctx('MISSING_ON_INVOICE', 'warn'))).toMatchObject({
      ruleId: 'non-leak-acknowledge',
      requiredRole: null,
    });
  });

  it('leak rows still reach the cumulative rules', () => {
    expect(evaluateApproval(ctx('QTY_SHORT', 'warn')).ruleId).toBe('cumulative-large');
  });

  it('holds with per-restaurant thresholds too', () => {
    const rules = buildRules(resolveApprovalThresholds({ cumulativeLargeAmount: 1, cumulativeMediumAmountMin: 0 }));
    expect(evaluateApproval(ctx('PRICE_LOWER', 'info'), rules).ruleId).toBe('non-leak-acknowledge');
  });
});

describe('pay-approval rule (decision 9)', () => {
  const t = DEFAULT_PAY_APPROVAL_THRESHOLDS;

  it('known supplier, at or under ₪N → no owner approval', () => {
    expect(evaluatePayApproval({ totalInclVat: 5000, supplierPriorInvoices: 3 }, t)).toEqual({
      requiresOwner: false,
      requiredRole: null,
      reasons: [],
    });
  });

  it('over ₪N by one agora → owner', () => {
    expect(evaluatePayApproval({ totalInclVat: 5000.01, supplierPriorInvoices: 3 }, t)).toMatchObject({
      requiresOwner: true,
      requiredRole: 'owner',
      reasons: ['over_amount'],
    });
  });

  it('a new supplier (first invoice) → owner, whatever the amount', () => {
    expect(evaluatePayApproval({ totalInclVat: 12, supplierPriorInvoices: 0 }, t).reasons).toEqual(['new_supplier']);
  });

  it('both reasons are reported', () => {
    expect(evaluatePayApproval({ totalInclVat: 9000, supplierPriorInvoices: 0 }, t).reasons).toEqual([
      'over_amount',
      'new_supplier',
    ]);
  });

  it('thresholds are read from settings.approvalThresholds; bad values fall back', () => {
    expect(resolvePayApprovalThresholds({ payApprovalOverAmount: 2500, newSupplierInvoiceCount: 3, cumulativeLargeAmount: 1 })).toEqual({
      payApprovalOverAmount: 2500,
      newSupplierInvoiceCount: 3,
    });
    expect(resolvePayApprovalThresholds({ payApprovalOverAmount: -1, newSupplierInvoiceCount: 'x' })).toEqual(t);
    expect(resolvePayApprovalThresholds(null)).toEqual(t);
    const custom = resolvePayApprovalThresholds({ payApprovalOverAmount: 2500, newSupplierInvoiceCount: 3 });
    expect(evaluatePayApproval({ totalInclVat: 3000, supplierPriorInvoices: 2 }, custom).reasons).toEqual([
      'over_amount',
      'new_supplier',
    ]);
  });
});
