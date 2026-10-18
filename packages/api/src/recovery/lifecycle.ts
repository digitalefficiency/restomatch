import type { RecoveryStatus } from '@restomatch/db';

/**
 * The "₪ back" lifecycle of one claimed discrepancy:
 *
 *   claimed → letter_sent → acknowledged → credited → recovered (money back)
 *
 * Steps may be skipped forward (a supplier can credit without acknowledging);
 * `disputed` and `written_off` are side states. A disputed claim can be pushed
 * forward again; a written-off claim can only be re-opened (→ claimed).
 * `credited` is entered through a credit note (recordCreditNote), never a bare
 * status flip, so every credited shekel is backed by a credit-note row.
 */
export const RECOVERY_TRANSITIONS: Record<RecoveryStatus, readonly RecoveryStatus[]> = {
  claimed: ['letter_sent', 'acknowledged', 'disputed', 'written_off'],
  letter_sent: ['acknowledged', 'disputed', 'written_off'],
  acknowledged: ['disputed', 'written_off'],
  credited: ['recovered', 'disputed'],
  recovered: [],
  disputed: ['letter_sent', 'acknowledged', 'written_off'],
  written_off: ['claimed'],
};

/** Statuses a credit note may be applied to. */
export const CREDITABLE: readonly RecoveryStatus[] = ['claimed', 'letter_sent', 'acknowledged', 'disputed'];

/** Statuses whose remaining amount is still owed by the supplier. */
export const OPEN_STATUSES: readonly RecoveryStatus[] = [
  'claimed',
  'letter_sent',
  'acknowledged',
  'credited',
  'disputed',
];

/** Statuses the overdue reminder chases (waiting on the supplier). */
export const AWAITING_SUPPLIER: readonly RecoveryStatus[] = ['claimed', 'letter_sent', 'acknowledged'];

export function canTransition(from: RecoveryStatus, to: RecoveryStatus): boolean {
  return RECOVERY_TRANSITIONS[from].includes(to);
}

/** Timestamp column stamped when a claim enters `to`. */
export function stampFor(
  to: RecoveryStatus,
): 'letterSentAt' | 'acknowledgedAt' | 'creditedAt' | 'recoveredAt' | 'closedAt' | null {
  switch (to) {
    case 'letter_sent':
      return 'letterSentAt';
    case 'acknowledged':
      return 'acknowledgedAt';
    case 'credited':
      return 'creditedAt';
    case 'recovered':
      return 'recoveredAt';
    case 'written_off':
      return 'closedAt';
    default:
      return null;
  }
}

/**
 * Split a credit note over claims, oldest first: each claim receives at most
 * what is still owed on it. Integer agorot in, integer agorot out; the sum of
 * allocations never exceeds the note. Returns the unallocated remainder too.
 */
export function allocateCredit(
  noteAgorot: number,
  claims: ReadonlyArray<{ id: string; amountAgorot: number; creditedAgorot: number }>,
): { allocations: Array<{ id: string; agorot: number }>; remainder: number } {
  if (!Number.isSafeInteger(noteAgorot) || noteAgorot <= 0) throw new Error('credit note must be a positive integer of agorot');
  let left = noteAgorot;
  const allocations: Array<{ id: string; agorot: number }> = [];
  for (const c of claims) {
    const owed = Math.max(0, c.amountAgorot - c.creditedAgorot);
    const take = Math.min(owed, left);
    if (take > 0) {
      allocations.push({ id: c.id, agorot: take });
      left -= take;
    }
    if (left === 0) break;
  }
  return { allocations, remainder: left };
}

/** Ageing bucket of an outstanding claim, by days since it was claimed. */
export type AgeingBucket = 'd0_30' | 'd31_60' | 'd61_90' | 'd90p';
export function ageingBucket(days: number): AgeingBucket {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90p';
}
