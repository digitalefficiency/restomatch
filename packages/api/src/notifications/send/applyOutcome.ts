/**
 * Apply a deliverOutboxRow() outcome to the claimed outbox row (H-05 slice b).
 * The dispatcher (outboxDispatch.ts, after AU-04 + #173) replaces its
 * hand-written status updates with this one call; a thrown provider error
 * stays on the dispatcher's existing backoff path.
 *
 * Every update is guarded to the row still being `sending` (the claim), so a
 * late or duplicated apply can never downgrade a row that already left.
 */
import { notificationsOutbox, sql, type Database } from '@restomatch/db';
import type { DeliveryOutcome } from './deliver';

export type AppliedStatus = 'sent' | 'failed';

/** The column values an outcome writes (pure; `externalId` is merged separately). */
export function outcomeStatus(outcome: DeliveryOutcome): { status: AppliedStatus; lastError: string | null } {
  if (outcome.outcome === 'sent') return { status: 'sent', lastError: null };
  return { status: 'failed', lastError: outcome.reason };
}

export async function applyDeliveryOutcome(db: Database, rowId: string, outcome: DeliveryOutcome): Promise<boolean> {
  const { status, lastError } = outcomeStatus(outcome);
  const claimed = sql`${notificationsOutbox.id} = ${rowId} and ${notificationsOutbox.status} = 'sending'`;
  const rows =
    outcome.outcome === 'sent'
      ? await db
          .update(notificationsOutbox)
          .set({
            status,
            sentAt: new Date(),
            lastError: null,
            claimedAt: null,
            ...(outcome.externalId
              ? {
                  payload: sql`coalesce(${notificationsOutbox.payload}, '{}'::jsonb) || jsonb_build_object('externalId', ${outcome.externalId}::text)`,
                }
              : {}),
          })
          .where(claimed)
          .returning({ id: notificationsOutbox.id })
      : await db
          .update(notificationsOutbox)
          .set({ status, lastError, claimedAt: null })
          .where(claimed)
          .returning({ id: notificationsOutbox.id });
  return rows.length === 1;
}
