/**
 * The typed domain-event union (G-05). One event per lifecycle transition, plus
 * the hand-offs that are not a status move (`discrepancy.escalated` is both).
 *
 * An event is a FACT that has already committed in the caller's transaction:
 * effects react to it (audit, activity, task, notify, claim) and never decide
 * whether it happened. See events/effects.ts for who reacts to what.
 */

/** Events the lifecycle kernel emits, one per machine edge (lifecycle/machines.ts). */
export const TRANSITION_EVENT_TYPES = [
  // invoice
  'invoice.ocr_parsed',
  'invoice.match_completed',
  'invoice.approved_for_payment',
  'invoice.marked_paid',
  'invoice.unmarked_paid',
  'invoice.rematch_locked',
  'invoice.external_sync',
  'invoice.reocr_requested',
  'invoice.retired',
  // discrepancy
  'discrepancy.accepted',
  'discrepancy.rejected',
  'discrepancy.escalated',
  'discrepancy.resolved',
  'discrepancy.reopened',
  // recovery claim
  'recovery.letter_sent',
  'recovery.acknowledged',
  'recovery.disputed',
  'recovery.written_off',
  'recovery.reopened',
  'recovery.credited',
  'recovery.recovered',
] as const;
export type TransitionEventType = (typeof TRANSITION_EVENT_TYPES)[number];

/** Hand-offs that are not (only) a status move; adopters emit them directly. */
export const HANDOFF_EVENT_TYPES = [
  'supplier.answered',
  'receipt.closed_with_exceptions',
  'invoice.ocr_failed',
] as const;
export type HandoffEventType = (typeof HANDOFF_EVENT_TYPES)[number];

export type DomainEventType = TransitionEventType | HandoffEventType;
export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = [...TRANSITION_EVENT_TYPES, ...HANDOFF_EVENT_TYPES];

interface EventBase {
  restaurantId: string;
  /** Acting user; null for system moves (OCR, match, external sync). */
  actorId: string | null;
  /** Event time, stamped once by whoever committed the fact (the kernel for transitions). */
  at: Date;
  entityType: string;
  entityId: string;
}

/** A committed lifecycle move. `payload` is exactly what the caller passed to `transition()`. */
export interface TransitionEvent extends EventBase {
  type: TransitionEventType;
  machine: string;
  event: string;
  from: string;
  to: string;
  payload: Record<string, unknown>;
}

export interface SupplierAnsweredEvent extends EventBase {
  type: 'supplier.answered';
  entityType: 'recovery_claim' | 'claim_letter' | 'purchase_order';
  payload: { supplierId: string; channel?: string; answer?: string; [k: string]: unknown };
}

export interface ReceiptClosedWithExceptionsEvent extends EventBase {
  type: 'receipt.closed_with_exceptions';
  entityType: 'goods_receipt';
  payload: { poId?: string | null; exceptionLines: number; [k: string]: unknown };
}

export interface InvoiceOcrFailedEvent extends EventBase {
  type: 'invoice.ocr_failed';
  entityType: 'invoice';
  payload: { reason: string; attempt?: number; [k: string]: unknown };
}

export type DomainEvent =
  | TransitionEvent
  | SupplierAnsweredEvent
  | ReceiptClosedWithExceptionsEvent
  | InvoiceOcrFailedEvent;
