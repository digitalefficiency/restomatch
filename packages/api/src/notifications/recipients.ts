/**
 * Resolve who should receive a restaurant-level notification.
 *
 * The outbox dispatcher sends `target` verbatim as the destination address, so
 * unlike the in-app `role:manager` symbolic targets (WhatsApp/push), email
 * notifications must be enqueued with a REAL recipient address. These helpers
 * turn a restaurant + a set of roles into the concrete, verified email
 * addresses of its members.
 *
 * Undeliverable addresses (the demo tenant's domain, any reserved TLD) are left
 * out in production and whenever a real email provider is configured: each one
 * would bounce and burn the Resend quota (100/day on the free tier). Otherwise
 * nothing is sent anyway, so local runs and tests still see every member.
 */
import {
  and,
  eq,
  inArray,
  memberships,
  users,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { isResendConfigured, type NotifierFactoryEnv } from './factory';
import { isUndeliverableAddress } from './sendWindow';

/** Re-exported: the one implementation lives in sendWindow.ts. */
export { isUndeliverableAddress };

export interface Recipient {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/** Roles that should receive operational alerts (delays, reminders, approvals). */
export const MANAGER_ROLES: UserRole[] = ['owner', 'manager'];

/**
 * Member email addresses for a restaurant, optionally filtered by role.
 * De-duplicates by email (a user can hold several roles). Defaults to the
 * owner+manager set used for operational alerts.
 */
export async function recipientsForRestaurant(
  db: Database,
  restaurantId: string,
  roles: UserRole[] = MANAGER_ROLES,
  env: NotifierFactoryEnv = process.env as NotifierFactoryEnv,
): Promise<Recipient[]> {
  if (roles.length === 0) return [];

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(eq(memberships.restaurantId, restaurantId), inArray(memberships.role, roles)),
    );

  // Production, or a real provider configured: a reserved-TLD address would
  // only bounce. Dev and test without a provider keep every member.
  const dropUndeliverable =
    (env as NotifierFactoryEnv & { NODE_ENV?: string }).NODE_ENV === 'production' || isResendConfigured(env);
  const byEmail = new Map<string, Recipient>();
  for (const r of rows) {
    if (!r.email) continue;
    if (dropUndeliverable && isUndeliverableAddress(r.email)) {
      // Domain only: never the mailbox.
      console.info(
        `[recipients] skipped undeliverable address @${r.email.split('@').pop()} (restaurant ${restaurantId.slice(0, 8)})`,
      );
      continue;
    }
    if (!byEmail.has(r.email)) {
      byEmail.set(r.email, {
        userId: r.userId,
        email: r.email,
        name: r.name,
        role: r.role,
      });
    }
  }
  return [...byEmail.values()];
}
