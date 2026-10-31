/**
 * W2-04 — the money limits on fast decisions, enforced by the SERVER (owner
 * decision: bulk approve ≤ ₪200 per invoice, one-tap approve ≤ ₪500, a blocking
 * item is never bulk- or one-tap-approved). The web BatchBar reads the same cap
 * (`DEFAULT_BULK_CAP_AGOROT`, asserted equal in a web unit test), but the UI is
 * only a hint: `approvals.decideMany` and `approvals.approve({channel:'quick'})`
 * refuse on their own. `approvals/engine.ts` (the routing rules) is untouched.
 *
 * Integer agorot throughout; no floats compared.
 */

/** Bulk approve: Σ selected claimable ₪ per invoice must be ≤ ₪200.00. */
export const BULK_APPROVE_CAP_AGOROT = 20_000;
/** One-tap approve (the future WhatsApp / push button of H-05): one item ≤ ₪500.00. */
export const ONE_TAP_APPROVE_CAP_AGOROT = 50_000;
/** At most this many items in one `decideMany` call. */
export const DECIDE_MANY_MAX_ITEMS = 100;

export type BulkRefusal = 'block' | 'over_cap';

export interface BulkCandidate {
  discrepancyId: string;
  /** null = no invoice yet: the row is its own group. */
  invoiceId: string | null;
  severity: string;
  /** The row's claimable ₪ in agorot (0 when nothing is claimable). */
  claimAgorot: number;
}

/**
 * Why each refused item may not be decided in bulk (empty map = all allowed).
 *  • `block` — a blocking item is decided one at a time, never in bulk;
 *  • `over_cap` — the selected items of its invoice claim more than the cap
 *    together (every selected item of that invoice is refused, so the batch is
 *    all-or-nothing per invoice too).
 */
export function bulkRefusals(
  items: ReadonlyArray<BulkCandidate>,
  capAgorot: number = BULK_APPROVE_CAP_AGOROT,
): Map<string, BulkRefusal> {
  const out = new Map<string, BulkRefusal>();
  const perInvoice = new Map<string, number>();
  const groupOf = (c: BulkCandidate) => c.invoiceId ?? `row:${c.discrepancyId}`;
  for (const c of items) {
    const key = groupOf(c);
    perInvoice.set(key, (perInvoice.get(key) ?? 0) + Math.max(0, Math.round(c.claimAgorot)));
  }
  for (const c of items) {
    if (c.severity === 'block') out.set(c.discrepancyId, 'block');
    else if ((perInvoice.get(groupOf(c)) ?? 0) > capAgorot) out.set(c.discrepancyId, 'over_cap');
  }
  return out;
}

export type QuickRefusal = 'block' | 'over_cap';

/** May this one item be approved through the one-tap channel? null = yes. */
export function quickApproveRefusal(c: { severity: string; claimAgorot: number }): QuickRefusal | null {
  if (c.severity === 'block') return 'block';
  if (Math.round(c.claimAgorot) > ONE_TAP_APPROVE_CAP_AGOROT) return 'over_cap';
  return null;
}
