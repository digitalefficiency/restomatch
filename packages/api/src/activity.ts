import { activityEvents, type Database } from '@restomatch/db';

export type ActivityEventType =
  | 'invoice_received'
  | 'invoice_matched'
  | 'discrepancy_approved'
  | 'discrepancy_rejected'
  | 'alias_learned'
  | 'sync_completed';

export interface ActivityEventInput {
  restaurantId: string;
  eventType: ActivityEventType;
  title: string;
  detail?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append an event to the restaurant's activity timeline. Logging must never
 * break the primary mutation, so failures are swallowed and logged.
 */
export async function logActivity(db: Database, e: ActivityEventInput): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      restaurantId: e.restaurantId,
      eventType: e.eventType,
      title: e.title,
      detail: e.detail ?? null,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      actorId: e.actorId ?? null,
      metadata: e.metadata ?? {},
    });
  } catch (err) {
    console.error('[activity] failed to log event', err);
  }
}
