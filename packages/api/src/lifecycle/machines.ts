import {
  discrepancies,
  invoices,
  invoiceStatus,
  RECOVERY_STATUSES,
  recoveryClaims,
  recoveryEvents,
  resolutionStatus,
  sql,
  type Database,
} from '@restomatch/db';
import { stampFor } from '../recovery/lifecycle';
import { columnType } from './capabilities';
import { defineMachine, type MoveContext } from './kernel';

export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export type ResolutionStatus = (typeof resolutionStatus.enumValues)[number];
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

/** Write `value` into an optional (G-03 / H-03) column when it exists; a no-op before. */
async function setOptionalColumn(
  tx: Database,
  table: 'invoices' | 'discrepancies',
  column: string,
  id: string,
  restaurantId: string,
  value: string | Date | null,
): Promise<boolean> {
  const type = await columnType(tx, table, column);
  if (!type) return false;
  const v = value instanceof Date ? value.toISOString() : value;
  await tx.execute(sql`
    UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${v}::${sql.raw(type)}
    WHERE id = ${id}::uuid AND restaurant_id = ${restaurantId}::uuid
  `);
  return true;
}

// ── invoice ───────────────────────────────────────────────────────────────

/**
 * Invoice lifecycle. Owner decision (payment): `mark_paid`, `unmark` and
 * `external_sync` touch ONLY the invoice row — never claims, discrepancies or
 * letters; a paid invoice keeps its claims. The kernel stamps the event time,
 * so "נתפס" can be measured at decision time against payment time (G-14).
 * Until H-03 is deployed `mark_paid` is defined but adopters must not enable it
 * (W2-03 rule). `invoices.paid_at` is written once H-03's column exists.
 */
export const invoiceMachine = defineMachine({
  name: 'invoice',
  entityType: 'invoice',
  table: invoices,
  idColumn: invoices.id,
  restaurantColumn: invoices.restaurantId,
  statusColumn: invoices.status,
  states: invoiceStatus.enumValues,
  initial: ['ocr_pending'],
  edges: {
    ocr_parsed: {
      from: ['ocr_pending', 'parsed'],
      to: 'parsed',
      kind: 'forward',
      audit: 'invoice.ocr_parsed',
      domainEvent: 'invoice.ocr_parsed',
    },
    match_completed: {
      // A re-match never leaves approved/paid (INVOICE_REMATCH_LOCKED): those
      // rows take `rematch_lock` instead.
      from: ['parsed', 'matched', 'disputed'],
      to: ['matched', 'disputed'],
      kind: 'forward',
      audit: 'invoice.match_completed',
      domainEvent: 'invoice.match_completed',
    },
    approve_for_payment: {
      from: ['matched', 'disputed'],
      to: 'approved',
      kind: 'forward',
      undoable: true,
      audit: 'invoice.approved_for_payment',
      domainEvent: 'invoice.approved_for_payment',
    },
    mark_paid: {
      from: ['approved'],
      to: 'paid',
      kind: 'forward',
      undoable: true,
      audit: 'invoice.marked_paid',
      domainEvent: 'invoice.marked_paid',
    },
    unmark: {
      from: ['paid'],
      to: 'approved',
      kind: 'reopen',
      audit: 'invoice.unmarked_paid',
      domainEvent: 'invoice.unmarked_paid',
    },
    rematch_lock: {
      // Record-only: a re-match hit a payment decision and left the status alone.
      from: ['approved', 'paid'],
      to: null,
      kind: 'side',
      audit: 'invoice.rematch_locked',
      domainEvent: 'invoice.rematch_locked',
    },
    external_sync: {
      // The accounting system reports the invoice paid.
      from: ['parsed', 'matched', 'disputed', 'approved'],
      to: 'paid',
      kind: 'forward',
      audit: 'invoice.external_sync',
      domainEvent: 'invoice.external_sync',
    },
  },
  patch: (c) => ({ updatedAt: c.at }),
  afterMove: async (tx, c) => {
    if (c.to === 'paid' && c.from !== 'paid') await setOptionalColumn(tx, 'invoices', 'paid_at', c.id, c.restaurantId, c.at);
    if (c.event === 'unmark') await setOptionalColumn(tx, 'invoices', 'paid_at', c.id, c.restaurantId, null);
  },
});

// ── discrepancy ───────────────────────────────────────────────────────────

/** G-03 `discrepancies.decision` vocabulary. */
export const DISCREPANCY_DECISIONS = [
  'claim',
  'waive',
  'acknowledge',
  'hold_duplicate',
  'release_duplicate',
  'link_po',
  'tolerate',
] as const;
export type DiscrepancyDecision = (typeof DISCREPANCY_DECISIONS)[number];

/** Default decision per deciding event, when the caller passes none. */
const DEFAULT_DECISION: Partial<Record<string, DiscrepancyDecision>> = {
  accept: 'claim',
  reject: 'waive',
  resolve: 'acknowledge',
};

function decisionOf(c: MoveContext<string, string>): DiscrepancyDecision | null {
  const d = c.payload.decision;
  if (typeof d === 'string' && (DISCREPANCY_DECISIONS as readonly string[]).includes(d)) return d as DiscrepancyDecision;
  return DEFAULT_DECISION[c.event] ?? null;
}

/**
 * Discrepancy lifecycle. A decision is taken only from `open|escalated`
 * (functional-flows-08). The decision is recorded in `discrepancies.decision`
 * once G-03 is deployed, and always in the audit row's `after.decision` (the
 * interim source of truth). Audit actions keep the wave-1 taxonomy
 * (`discrepancy.approved|rejected|escalated|reopened`), which approvals'
 * `decidedConflict` reads.
 */
export const discrepancyMachine = defineMachine({
  name: 'discrepancy',
  entityType: 'discrepancy',
  table: discrepancies,
  idColumn: discrepancies.id,
  restaurantColumn: discrepancies.restaurantId,
  statusColumn: discrepancies.resolutionStatus,
  states: resolutionStatus.enumValues,
  initial: ['open'],
  edges: {
    accept: {
      from: ['open', 'escalated'],
      to: 'accepted',
      kind: 'forward',
      undoable: true,
      audit: 'discrepancy.approved',
      domainEvent: 'discrepancy.accepted',
    },
    reject: {
      from: ['open', 'escalated'],
      to: 'rejected',
      kind: 'forward',
      undoable: true,
      audit: 'discrepancy.rejected',
      domainEvent: 'discrepancy.rejected',
    },
    escalate: {
      from: ['open', 'escalated'],
      to: 'escalated',
      kind: 'side',
      audit: 'discrepancy.escalated',
      domainEvent: 'discrepancy.escalated',
    },
    resolve: {
      from: ['open', 'escalated'],
      to: 'resolved',
      kind: 'forward',
      undoable: true,
      audit: 'discrepancy.decided',
      domainEvent: 'discrepancy.resolved',
    },
    reopen: {
      // Undo of a decision: back to the state it was decided from.
      from: ['accepted', 'rejected', 'resolved'],
      to: ['open', 'escalated'],
      kind: 'reopen',
      audit: 'discrepancy.reopened',
      domainEvent: 'discrepancy.reopened',
    },
  },
  patch: (c) => {
    if (c.event === 'reopen') return { resolvedBy: null, resolvedAt: null, resolutionNote: null };
    if (c.event === 'escalate') return {};
    const note = typeof c.payload.reason === 'string' ? c.payload.reason : typeof c.payload.note === 'string' ? c.payload.note : null;
    return { resolvedBy: c.actorId, resolvedAt: c.at, ...(note !== null ? { resolutionNote: note } : {}) };
  },
  auditAfter: (c) => (c.event === 'escalate' || c.event === 'reopen' ? {} : { decision: decisionOf(c) }),
  afterMove: async (tx, c) => {
    if (c.event === 'escalate') return;
    await setOptionalColumn(tx, 'discrepancies', 'decision', c.id, c.restaurantId, c.event === 'reopen' ? null : decisionOf(c));
  },
});

// ── recovery claim ────────────────────────────────────────────────────────

/**
 * Recovery-claim lifecycle — the same graph as recovery/lifecycle.ts
 * `RECOVERY_TRANSITIONS` (a table test pins it): only `recovered` is terminal,
 * `written_off` re-opens to `claimed`, and `credited` is entered only via a
 * credit note (`via: 'credit_note'`). W2-10 owns recovery/lifecycle.ts and will
 * re-export from here. The default history hook writes `recovery_events` like
 * `transitionClaim` does today; W2-10 may replace it with
 * `defineMachine({ ...recoveryMachine, history })`.
 */
export const recoveryMachine = defineMachine({
  name: 'recovery',
  entityType: 'recovery_claim',
  table: recoveryClaims,
  idColumn: recoveryClaims.id,
  restaurantColumn: recoveryClaims.restaurantId,
  statusColumn: recoveryClaims.status,
  states: RECOVERY_STATUSES,
  initial: ['claimed'],
  edges: {
    send_letter: {
      from: ['claimed', 'disputed'],
      to: 'letter_sent',
      kind: 'forward',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.letter_sent',
    },
    acknowledge: {
      from: ['claimed', 'letter_sent', 'disputed'],
      to: 'acknowledged',
      kind: 'forward',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.acknowledged',
    },
    dispute: {
      from: ['claimed', 'letter_sent', 'acknowledged', 'credited'],
      to: 'disputed',
      kind: 'side',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.disputed',
    },
    write_off: {
      from: ['claimed', 'letter_sent', 'acknowledged', 'disputed'],
      to: 'written_off',
      kind: 'side',
      requiresReason: true,
      undoable: true,
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.written_off',
    },
    reopen: {
      from: ['written_off'],
      to: 'claimed',
      kind: 'reopen',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.reopened',
    },
    credit: {
      from: ['claimed', 'letter_sent', 'acknowledged', 'credited', 'disputed'],
      to: 'credited',
      kind: 'forward',
      via: 'credit_note',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.credited',
    },
    recover: {
      from: ['credited'],
      to: 'recovered',
      kind: 'terminal',
      audit: 'recovery.transitioned',
      domainEvent: 'recovery.recovered',
    },
  },
  patch: (c) => {
    const stamp = stampFor(c.to);
    const note = typeof c.payload.note === 'string' ? c.payload.note : typeof c.payload.reason === 'string' ? c.payload.reason : null;
    return {
      updatedAt: c.at,
      ...(stamp ? { [stamp]: c.at } : {}),
      ...(c.to === 'claimed' ? { closedAt: null } : {}),
      ...(note !== null ? { note } : {}),
    };
  },
  history: async (tx, c) => {
    const note = typeof c.payload.note === 'string' ? c.payload.note : typeof c.payload.reason === 'string' ? c.payload.reason : null;
    await tx.insert(recoveryEvents).values({
      restaurantId: c.restaurantId,
      claimId: c.id,
      fromStatus: c.from,
      toStatus: c.to,
      actorId: c.actorId,
      note,
      createdAt: c.at,
    });
  },
});

export const MACHINES = { invoice: invoiceMachine, discrepancy: discrepancyMachine, recovery: recoveryMachine } as const;
