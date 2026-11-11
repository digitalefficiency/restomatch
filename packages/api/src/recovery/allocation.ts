import type { Database } from '@restomatch/db';
import { assertSupplierOwned } from '../tenant';
import { CREDITABLE } from './lifecycle';
import { listClaims, type RecoveryClaimRow } from './service';
import { suggestAllocation, type AllocationSuggestion } from './suggest';

export interface CreditAllocationProposal {
  suggestion: AllocationSuggestion;
  /** Every creditable claim of the supplier (open agorot > 0), oldest first; the UI lets the user adjust. */
  candidates: RecoveryClaimRow[];
}

/**
 * W3-11 · "שיוך זיכוי": propose which of the supplier's open credit requests a
 * credit note of `amountAgorot` (before VAT, the hero's basis) answers. Read
 * only; "אשר שיוך" confirms through recovery.recordCreditNote with the ids.
 * Tenant-scoped: a foreign supplier → NOT_FOUND before any claim is read.
 */
export async function proposeCreditAllocation(
  db: Database,
  restaurantId: string,
  input: { supplierId: string; amountAgorot: number },
): Promise<CreditAllocationProposal> {
  await assertSupplierOwned(db, input.supplierId, restaurantId);
  const rows = await listClaims(db, restaurantId, { supplierId: input.supplierId, limit: null });
  const candidates = rows
    .filter((c) => c.supplierId === input.supplierId)
    .filter((c) => (CREDITABLE as readonly string[]).includes(c.status) && c.outstandingAgorot > 0)
    .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id));
  const suggestion = suggestAllocation(
    input.amountAgorot,
    candidates.map((c) => ({
      id: c.id,
      invoiceId: c.invoiceId,
      amountAgorot: c.amountAgorot,
      creditedAgorot: c.creditedAgorot,
      claimedAt: c.claimedAt,
    })),
  );
  return { suggestion, candidates };
}
