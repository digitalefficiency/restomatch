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
 * Discrepancy types that are NEVER asked back from a supplier — the ONE list used by
 * approvals (isClaimableRow), these claim lines (letters, pay run), and the ₪-back
 * tracker's sync. Owner decision 31.10: MISSING_ON_INVOICE is not claimable ("לא") —
 * an ordered line that was never billed has nothing to credit.
 */
export const NEVER_CLAIMABLE_TYPES = ['PRICE_LOWER', 'UNORDERED_ARRIVAL', 'MISSING_ON_INVOICE'] as const;
const NEVER_CLAIMABLE = new Set<string>(NEVER_CLAIMABLE_TYPES);
export function isNeverClaimable(type: string): boolean {
  return NEVER_CLAIMABLE.has(type);
}

/**
 * Days a supplier has to answer a credit claim (from the letter, or the claim when no
 * letter went out) before it is overdue — owner decision 31.10: a week ("שבוע"). One
 * constant for the reminder job, the tracker's countdown and banner, the home row and
 * the letter's reply-by date.
 */
export const CLAIM_ANSWER_DAYS = 7;

/**
 * The overdue boundary, as cases both sides test against (server overdueSql and the
 * web countdown): a claim is overdue when MORE than CLAIM_ANSWER_DAYS whole calendar
 * days (Asia/Jerusalem) passed since the letter — the hour of day never matters.
 * `now` is 2026-10-25 13:00 in Israel.
 */
export const OVERDUE_BOUNDARY_NOW = '2026-10-25T10:00:00.000Z';
export const OVERDUE_BOUNDARY_CASES: ReadonlyArray<{ letterSentAt: string; overdue: boolean; why: string }> = [
  { letterSentAt: '2026-10-18T12:00:00.000Z', overdue: false, why: '18.10 15:00 IL — 7 calendar days: not yet' },
  { letterSentAt: '2026-10-17T22:30:00.000Z', overdue: false, why: '18.10 01:30 IL — 7 calendar days (an instant rule said overdue)' },
  { letterSentAt: '2026-10-17T20:59:00.000Z', overdue: true, why: '17.10 23:59 IL — 8 calendar days' },
  { letterSentAt: '2026-10-17T05:00:00.000Z', overdue: true, why: '17.10 08:00 IL — 8 calendar days' },
];

/**
 * What an amount is measured on. A duplicate invoice is claimed at the invoice's total
 * INCLUDING VAT; a VAT mismatch IS a VAT amount; every other discrepancy is priced on line
 * amounts BEFORE VAT. Shown next to each amount so ₪ figures of different bases are never
 * silently added up as if they were one.
 */
export type VatBasis = 'excl' | 'incl' | 'vat';

export function vatBasisOf(type: string): VatBasis {
  // Both carry the invoice's total incl. VAT as Δ (UNORDERED_ARRIVAL is never claimable, but may be shown).
  if (type === 'DUPLICATE_INVOICE' || type === 'UNORDERED_ARRIVAL') return 'incl';
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
    if (!l.countsAsLeak || !CLAIMABLE.has(l.resolutionStatus) || NEVER_CLAIMABLE.has(l.type)) continue;
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
