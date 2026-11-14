/**
 * W3-09 · Purchase-order lifecycle: ONE transition table, fired by events.
 *
 * Pure: no DB, no I/O. Slice b wires `poTransitionForEvent` into G-05's
 * transition kernel / `emit()` once that lands on main; until then nothing on
 * main calls it, so behaviour is unchanged.
 *
 * Rules (IMPLEMENTATION-PLAN §W3-09):
 *  - supplier confirm → `confirmed`;
 *  - goods receipt closed partial → `partial`;
 *  - goods receipt completed AND every invoice matched → `closed`;
 *  - "late" is derived at expected + 60 min, never stored.
 * A PO never moves backwards and never leaves `closed` / `cancelled`.
 */

export type PoStatus = 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';

export const PO_STATUSES: readonly PoStatus[] = ['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled'];

/** from → allowed targets. Anything not listed is refused. */
export const PO_TRANSITIONS: Readonly<Record<PoStatus, readonly PoStatus[]>> = {
  draft: ['sent', 'cancelled'],
  sent: ['confirmed', 'partial', 'closed', 'cancelled'],
  confirmed: ['partial', 'closed', 'cancelled'],
  partial: ['closed'],
  closed: [],
  cancelled: [],
};

export function canTransitionPo(from: PoStatus, to: PoStatus): boolean {
  return PO_TRANSITIONS[from].includes(to);
}

export type PoEvent =
  | { type: 'po.placed' }
  | { type: 'po.cancelled' }
  | { type: 'supplier.confirmed' }
  | { type: 'receipt.closed'; receiptStatus: 'partial' | 'completed'; allInvoicesMatched: boolean };

export type PoTransition =
  | { kind: 'move'; from: PoStatus; to: PoStatus }
  | { kind: 'noop'; reason: 'same_status' | 'not_applicable' }
  | { kind: 'refused'; from: PoStatus; to: PoStatus };

/** Target status an event asks for, or null when the event moves nothing. */
export function targetForEvent(event: PoEvent): PoStatus | null {
  switch (event.type) {
    case 'po.placed':
      return 'sent';
    case 'po.cancelled':
      return 'cancelled';
    case 'supplier.confirmed':
      return 'confirmed';
    case 'receipt.closed':
      if (event.receiptStatus === 'partial') return 'partial';
      // A completed receipt closes the PO only once every invoice is matched;
      // until then it stays where it is (sent/confirmed) and closes later.
      return event.allInvoicesMatched ? 'closed' : null;
  }
}

/**
 * What an event does to a PO in `current`. A supplier confirm arriving after
 * the goods (PO already partial/closed) is a no-op, not an error: events can
 * arrive out of order and the later truth wins.
 */
export function poTransitionForEvent(current: PoStatus, event: PoEvent): PoTransition {
  const to = targetForEvent(event);
  if (to === null) return { kind: 'noop', reason: 'not_applicable' };
  if (to === current) return { kind: 'noop', reason: 'same_status' };
  if (canTransitionPo(current, to)) return { kind: 'move', from: current, to };
  if (event.type === 'supplier.confirmed' && (current === 'partial' || current === 'closed')) {
    return { kind: 'noop', reason: 'not_applicable' };
  }
  return { kind: 'refused', from: current, to };
}

export const LATE_GRACE_MS = 60 * 60 * 1000;

/** Statuses for which a delivery is still awaited (so lateness is meaningful). */
const AWAITING_DELIVERY: ReadonlySet<PoStatus> = new Set(['sent', 'confirmed']);

/** Derived, never stored: expected delivery + 60 min has passed and nothing arrived. */
export function isPoLate(status: PoStatus, expectedAt: Date | null, now: Date): boolean {
  if (!expectedAt || !AWAITING_DELIVERY.has(status)) return false;
  return now.getTime() > expectedAt.getTime() + LATE_GRACE_MS;
}
