import type { Database } from '@restomatch/db';
import type { DomainEvent, DomainEventType } from './types';

/**
 * Who reacts to which domain event (G-05). This file declares effect KINDS per
 * event; the code that runs a kind lives with its owner and registers itself:
 *
 *   - `audit`    — written by the lifecycle kernel inline (exactly one row per
 *                  move, inside the decision); emit() never runs it.
 *   - `activity` — built in (activity.ts `logDomainEvent`), registered below.
 *   - `notify`   — G-06 registers from notifications/notify.ts.
 *   - `task`     — W2-08 registers from tasks/**.
 *   - `claim`    — W2-10 registers (claim materialisation on accept).
 *
 * Nobody edits this table to register a handler. A kind without a handler is a
 * logged skip, never a throw. Effects are INSERTS only: they never update the
 * row the event describes.
 */
export const EFFECT_KINDS = ['audit', 'activity', 'task', 'notify', 'claim'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export const EVENT_EFFECTS: Readonly<Record<DomainEventType, readonly EffectKind[]>> = {
  // invoice
  'invoice.ocr_parsed': ['audit', 'activity'],
  'invoice.match_completed': ['audit', 'activity', 'notify'],
  'invoice.approved_for_payment': ['audit', 'activity'],
  'invoice.marked_paid': ['audit', 'activity'],
  'invoice.unmarked_paid': ['audit', 'activity'],
  'invoice.rematch_locked': ['audit'],
  'invoice.external_sync': ['audit', 'activity'],
  'invoice.ocr_failed': ['activity', 'notify', 'task'],
  // discrepancy
  'discrepancy.accepted': ['audit', 'activity', 'claim'],
  'discrepancy.rejected': ['audit', 'activity'],
  'discrepancy.escalated': ['audit', 'activity', 'notify', 'task'],
  'discrepancy.resolved': ['audit', 'activity'],
  'discrepancy.reopened': ['audit', 'activity'],
  // recovery claim
  'recovery.letter_sent': ['audit', 'activity'],
  'recovery.acknowledged': ['audit', 'activity'],
  'recovery.disputed': ['audit', 'activity', 'task'],
  'recovery.written_off': ['audit', 'activity'],
  'recovery.reopened': ['audit', 'activity'],
  'recovery.credited': ['audit', 'activity'],
  'recovery.recovered': ['audit', 'activity'],
  // hand-offs
  'supplier.answered': ['activity', 'notify', 'task'],
  'receipt.closed_with_exceptions': ['activity', 'notify', 'task'],
};

/**
 * An effect handler. `db` is a SAVEPOINT inside the caller's tenant transaction:
 * a throw rolls back only the effect's own inserts, never the decision.
 */
export type EffectHandler = (db: Database, event: DomainEvent) => Promise<void>;

const handlers = new Map<EffectKind, EffectHandler>();

/**
 * Register the handler for one effect kind (one per kind; the last one wins so
 * a test can swap it). Returns an unregister function.
 */
export function registerEffectHandler(kind: Exclude<EffectKind, 'audit'>, fn: EffectHandler): () => void {
  const prev = handlers.get(kind);
  handlers.set(kind, fn);
  return () => {
    if (handlers.get(kind) !== fn) return;
    if (prev) handlers.set(kind, prev);
    else handlers.delete(kind);
  };
}

export function effectHandler(kind: EffectKind): EffectHandler | undefined {
  return handlers.get(kind);
}
