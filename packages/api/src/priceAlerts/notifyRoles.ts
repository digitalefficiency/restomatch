import type { Database, UserRole } from '@restomatch/db';
import { enqueueNotification } from '../notifications/outbox';
import { recipientsForRestaurant, type Recipient } from '../notifications/recipients';

/**
 * INTERIM role-audience sender for the AU-13 digest, until G-06's `notify()`
 * (role audiences, quiet hours / Shabbat, ≤6 per person per day) merges. Today:
 * `recipientsForRestaurant` (verified member e-mails of ONE restaurant, by role)
 * + `enqueueNotification` with a dedupe key. On G-06's merge the body becomes a
 * `notify(tx, { audience: { roles }, … })` call — one line per caller.
 *
 * Roles are explicit at every call: the receiver and the bookkeeper are never
 * passed, so they never get a row.
 */
export async function digestRecipients(db: Database, restaurantId: string, roles: UserRole[]): Promise<Recipient[]> {
  return recipientsForRestaurant(db, restaurantId, roles);
}

export async function enqueueDigest(
  db: Database,
  args: {
    restaurantId: string;
    recipient: Recipient;
    subject: string;
    text: string;
    html: string;
    dedupeKey: string;
    relatedEntityType: string;
    relatedEntityId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  const { deduped } = await enqueueNotification(db, {
    restaurantId: args.restaurantId,
    channel: 'email',
    target: args.recipient.email,
    subject: args.subject,
    body: args.text,
    html: args.html,
    payload: args.payload,
    relatedEntityType: args.relatedEntityType,
    relatedEntityId: args.relatedEntityId ?? undefined,
    dedupeKey: args.dedupeKey,
  });
  return !deduped;
}
