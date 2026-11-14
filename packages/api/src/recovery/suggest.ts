import { allocateCredit } from './lifecycle';

/**
 * W3-11 · "שיוך זיכוי": which open credit requests a supplier's credit note
 * (חשבונית זיכוי / תעודת זיכוי) most likely answers.
 *
 * Pure and deterministic. Integer agorot in, integer agorot out. The caller
 * passes only claims of the note's supplier that are still creditable; this
 * function never widens that set. The suggestion is confirmed by the user
 * ("אשר שיוך") through recordCreditNote with exactly the suggested claim ids.
 *
 * A credit note is never a short-pay: it only reduces credit requests. It is
 * never netted against an invoice's payable or read as an underpayment.
 *
 * Order of preference:
 *   1. exact_single   — one claim whose open amount equals the note;
 *   2. exact_invoice  — all open claims of one invoice summing to the note (the
 *                       supplier credited "the whole invoice's gaps");
 *   3. exact_subset   — the oldest-first-lexicographic subset of the oldest
 *                       SUBSET_WINDOW claims summing to the note;
 *   4. oldest_first   — no exact match: fill the oldest claims first; any rest
 *                       stays on the note as unallocated.
 */

export interface SuggestClaim {
  id: string;
  invoiceId: string | null;
  amountAgorot: number;
  creditedAgorot: number;
  /** ISO or Date: ordering only. */
  claimedAt: string | Date;
}

export type SuggestBasis = 'exact_single' | 'exact_invoice' | 'exact_subset' | 'oldest_first' | 'none';

export interface AllocationSuggestion {
  basis: SuggestBasis;
  allocations: Array<{ id: string; agorot: number }>;
  allocatedAgorot: number;
  /** Part of the note no selected claim absorbs (stays on the note). */
  remainderAgorot: number;
  /** Σ open agorot of every candidate claim (context for the UI). */
  openAgorot: number;
}

/** Claims considered by the bounded exact-subset search (2^16 subsets at most). */
export const SUBSET_WINDOW = 16;

const openOf = (c: SuggestClaim) => Math.max(0, c.amountAgorot - c.creditedAgorot);
const timeOf = (c: SuggestClaim) => (c.claimedAt instanceof Date ? c.claimedAt.getTime() : Date.parse(c.claimedAt));

function oldestFirst(claims: readonly SuggestClaim[]): SuggestClaim[] {
  return [...claims].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));
}

function exact(basis: SuggestBasis, picked: readonly SuggestClaim[], openAgorot: number): AllocationSuggestion {
  const allocations = picked.map((c) => ({ id: c.id, agorot: openOf(c) }));
  const allocatedAgorot = allocations.reduce((s, a) => s + a.agorot, 0);
  return { basis, allocations, allocatedAgorot, remainderAgorot: 0, openAgorot };
}

export function suggestAllocation(noteAgorot: number, claims: readonly SuggestClaim[]): AllocationSuggestion {
  if (!Number.isSafeInteger(noteAgorot) || noteAgorot <= 0) {
    throw new Error('credit note must be a positive integer of agorot');
  }
  const open = oldestFirst(claims.filter((c) => openOf(c) > 0));
  const openAgorot = open.reduce((s, c) => s + openOf(c), 0);
  if (open.length === 0) {
    return { basis: 'none', allocations: [], allocatedAgorot: 0, remainderAgorot: noteAgorot, openAgorot: 0 };
  }

  const single = open.find((c) => openOf(c) === noteAgorot);
  if (single) return exact('exact_single', [single], openAgorot);

  // One invoice's open claims, in the order of the invoice's oldest claim.
  const byInvoice = new Map<string, SuggestClaim[]>();
  for (const c of open) {
    if (!c.invoiceId) continue;
    const list = byInvoice.get(c.invoiceId) ?? [];
    list.push(c);
    byInvoice.set(c.invoiceId, list);
  }
  for (const list of byInvoice.values()) {
    if (list.length > 1 && list.reduce((s, c) => s + openOf(c), 0) === noteAgorot) {
      return exact('exact_invoice', list, openAgorot);
    }
  }

  // Bounded exact subset over the oldest claims. Masks are visited so that the
  // first hit is the one built from the oldest claims (lexicographic on age).
  const window = open.slice(0, SUBSET_WINDOW);
  const n = window.length;
  let best: number | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    for (let i = 0; i < n && sum <= noteAgorot; i++) if (mask & (1 << i)) sum += openOf(window[i]!);
    if (sum !== noteAgorot) continue;
    if (best === null || olderSet(mask, best, n)) best = mask;
  }
  if (best !== null) {
    const picked = window.filter((_, i) => best! & (1 << i));
    return exact('exact_subset', picked, openAgorot);
  }

  const { allocations, remainder } = allocateCredit(noteAgorot, open);
  return {
    basis: 'oldest_first',
    allocations,
    allocatedAgorot: noteAgorot - remainder,
    remainderAgorot: remainder,
    openAgorot,
  };
}

/** True when subset `a` is built from older claims than `b` (compare the oldest differing member). */
function olderSet(a: number, b: number, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const inA = (a >> i) & 1;
    const inB = (b >> i) & 1;
    if (inA !== inB) return inA === 1;
  }
  return false;
}
