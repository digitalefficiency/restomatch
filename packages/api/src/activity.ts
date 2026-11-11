import { activityEvents, type Database } from '@restomatch/db';
import { hasEnumValue } from './lifecycle/capabilities';

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

/**
 * G-05: a domain-event row in the activity timeline — `event_type = 'event'`
 * with the event name in `metadata.kind`. The `'event'` enum value ships with
 * G-03 (deployed ≥ 10.11); until it exists this writes NO row and logs one
 * warning per process. It never throws unless `throwOnError` is set (the
 * events/emit savepoint wants to see a real failure), and it runs inside its
 * own savepoint, so a failed insert never poisons the caller's transaction.
 */
export interface DomainActivityInput {
  restaurantId: string;
  /** The domain event name, e.g. `discrepancy.escalated` (stored as `metadata.kind`). */
  kind: string;
  title: string;
  detail?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  throwOnError?: boolean;
}

let warnedNoEventKind = false;

export async function logDomainEvent(db: Database, e: DomainActivityInput): Promise<'written' | 'skipped' | 'failed'> {
  if (!(await hasEnumValue(db, 'activity_event_type', 'event'))) {
    if (!warnedNoEventKind) {
      warnedNoEventKind = true;
      console.warn("[activity] activity_event_type has no 'event' value yet (G-03 not deployed) — domain events are not logged");
    }
    return 'skipped';
  }
  try {
    await db.transaction(async (sp) => {
      await sp.insert(activityEvents).values({
        restaurantId: e.restaurantId,
        eventType: 'event' as never, // G-03 enum value; the drizzle enum type catches up with G-03's schema.ts
        title: e.title,
        detail: e.detail ?? null,
        entityType: e.entityType ?? null,
        entityId: e.entityId ?? null,
        actorId: e.actorId ?? null,
        metadata: { ...(e.metadata ?? {}), kind: e.kind },
      });
    });
    return 'written';
  } catch (err) {
    if (e.throwOnError) throw err;
    console.error('[activity] failed to log domain event', err);
    return 'failed';
  }
}
