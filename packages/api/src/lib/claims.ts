import type { LeakBreakdownInvoice, LeakBreakdownLine } from '@restomatch/charts';

/**
 * The claimable-line rule (₪) shared by the supplier credit letters
 * (/dashboard/leaks/claims) and the pay run (/dashboard/approvals/pay-run).
 * One rule, so the two pages can never disagree on a shekel.
 *
 *  • an invoice still waiting for a PO link, or already marked paid, has nothing to claim;
 *  • a line is claimable when it counts as leak and is open, escalated or accepted (waived lines drop);
 *  • lines are taken in the breakdown's order (biggest |Δ| first) and never claim more on an
 *    invoice than its capped leak (`leakIls`, the hero's per-invoice cap).
 */
export const CLAIMABLE_STATUSES = ['open', 'escalated', 'accepted'] as const;
const CLAIMABLE = new Set<string>(CLAIMABLE_STATUSES);

/**
 * What an amount is measured on. A duplicate invoice is claimed at the invoice's total
 * INCLUDING VAT; a VAT mismatch IS a VAT amount; every other discrepancy is priced on line
 * amounts BEFORE VAT. Shown next to each amount so ₪ figures of different bases are never
 * silently added up as if they were one.
 */
export type VatBasis = 'excl' | 'incl' | 'vat';

export function vatBasisOf(type: string): VatBasis {
  if (type === 'DUPLICATE_INVOICE') return 'incl';
  if (type === 'VAT_MISMATCH') return 'vat';
  return 'excl';
}

export interface ClaimLine {
  line: LeakBreakdownLine;
  /** ₪ claimable on this line after the per-invoice cap. */
  amount: number;
  basis: VatBasis;
}

/** The claimable lines of one invoice, capped like the claims letters. */
export function claimableLines(inv: LeakBreakdownInvoice): ClaimLine[] {
  if (inv.pendingLink || inv.status === 'paid') return [];
  const out: ClaimLine[] = [];
  let invClaimed = 0;
  for (const l of inv.lines) {
    if (!l.countsAsLeak || !CLAIMABLE.has(l.resolutionStatus)) continue;
    // Never claim more on an invoice than its capped leak.
    const amount = Math.min(Math.abs(l.deltaAmount), Math.max(0, inv.leakIls - invClaimed));
    if (amount <= 0) continue;
    invClaimed += amount;
    out.push({ line: l, amount, basis: vatBasisOf(l.type) });
  }
  return out;
}

/** Σ of claim amounts, rounded to the agora (as the letters' totals). */
export function sumClaims(lines: ReadonlyArray<{ amount: number }>): number {
  return Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
}
