/**
 * Credits asked (דרישות זיכוי): the claimable part of a leak breakdown — the
 * same rule as the claim letters page. A line is claimable when it counts as
 * leak and is still open / escalated / accepted, on an unpaid invoice that is
 * linked to a PO; an invoice never yields more than its capped leak.
 */
export const CLAIMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'escalated', 'accepted']);

export interface ClaimInvoiceLike {
  status: string;
  pendingLink: boolean;
  leakIls: number;
  lines: Array<{ countsAsLeak: boolean; resolutionStatus: string; deltaAmount: number }>;
}

/** Claimable ₪ per line of one invoice (in order), capped at the invoice's leak. */
export function claimableLines<T extends ClaimInvoiceLike>(inv: T): Array<{ line: T['lines'][number]; amount: number }> {
  if (inv.pendingLink || inv.status === 'paid') return [];
  const out: Array<{ line: T['lines'][number]; amount: number }> = [];
  let claimed = 0;
  for (const l of inv.lines) {
    if (!l.countsAsLeak || !CLAIMABLE_STATUSES.has(l.resolutionStatus)) continue;
    const amount = Math.min(Math.abs(l.deltaAmount), Math.max(0, inv.leakIls - claimed));
    if (amount <= 0) continue;
    claimed += amount;
    out.push({ line: l, amount });
  }
  return out;
}

/** Σ claimable over invoices, in integer agorot. */
export function claimableAgorot(invoices: readonly ClaimInvoiceLike[]): number {
  return invoices.reduce(
    (sum, inv) => sum + claimableLines(inv).reduce((s, c) => s + Math.round(c.amount * 100), 0),
    0,
  );
}
