import { logDomainEvent } from '../activity';
import { registerEffectHandler } from './effects';
import type { DomainEvent } from './types';

/** The built-in `activity` effect: one `activity_events` row of kind `event`. */
registerEffectHandler('activity', async (db, event: DomainEvent) => {
  await logDomainEvent(db, {
    restaurantId: event.restaurantId,
    kind: event.type,
    title: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    actorId: event.actorId,
    metadata: {
      at: event.at.toISOString(),
      ...('from' in event ? { from: event.from, to: event.to } : {}),
    },
    throwOnError: true,
  });
});
