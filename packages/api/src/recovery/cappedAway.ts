import type { RecoveryStatus } from '@restomatch/db';

/** Claims still ASKING the supplier for money (no credit note booked yet). */
export const ASKING_STATUSES: readonly RecoveryStatus[] = ['claimed', 'letter_sent', 'acknowledged', 'disputed'];

export interface CappedAwayInput {
  status: RecoveryStatus;
  outstandingAgorot: number;
  amountAgorot: number;
  creditedAgorot: number;
  cappedAgorot?: number;
}

/**
 * G-14 Q3 R5-4 · a claim the invoice cap leaves at ₪0 BEFORE anything came back: still asking
 * (ASKING_STATUSES), nothing credited, its capped share (the leak ledger's allocator) below its
 * stored amount and nothing owed. It shows "₪0 · of ₪X (cap reached)", is not "to send", gets no
 * step button and is never auto-written off. A claim that was credited its full capped share is
 * NOT capped away — it keeps its `recovered` step (round 7, item 1).
 * Twin of apps/web recovery/logic isCappedAway; both run CAPPED_AWAY_CASES.
 */
export function isCappedAway(c: CappedAwayInput): boolean {
  return (
    ASKING_STATUSES.includes(c.status) &&
    c.creditedAgorot === 0 &&
    c.outstandingAgorot <= 0 &&
    (c.cappedAgorot ?? c.amountAgorot) < c.amountAgorot
  );
}

/** The cases both twins must agree on (api and web unit tests). */
export const CAPPED_AWAY_CASES: ReadonlyArray<{ claim: CappedAwayInput; cappedAway: boolean; why: string }> = [
  { claim: { status: 'claimed', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 0, cappedAgorot: 0 }, cappedAway: true, why: 'the cap took it all, nothing sent' },
  { claim: { status: 'letter_sent', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 0, cappedAgorot: 0 }, cappedAway: true, why: 'sent, then the total was lowered' },
  { claim: { status: 'claimed', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 200, cappedAgorot: 200 }, cappedAway: false, why: 'still owes its capped ₪2' },
  { claim: { status: 'credited', amountAgorot: 800, creditedAgorot: 200, outstandingAgorot: 0, cappedAgorot: 200 }, cappedAway: false, why: 'credited its full capped share: keeps the recovered step' },
  { claim: { status: 'letter_sent', amountAgorot: 800, creditedAgorot: 200, outstandingAgorot: 0, cappedAgorot: 200 }, cappedAway: false, why: 'something came back' },
  { claim: { status: 'claimed', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 0 }, cappedAway: false, why: 'no capped share known (outside the ledger)' },
  { claim: { status: 'recovered', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 0, cappedAgorot: 0 }, cappedAway: false, why: 'closed' },
  { claim: { status: 'written_off', amountAgorot: 800, creditedAgorot: 0, outstandingAgorot: 0, cappedAgorot: 0 }, cappedAway: false, why: 'closed' },
];
