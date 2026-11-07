/**
 * Resolve who should receive a restaurant-level notification.
 *
 * The outbox dispatcher sends `target` verbatim as the destination address, so
 * unlike the in-app `role:manager` symbolic targets (WhatsApp/push), email
 * notifications must be enqueued with a REAL recipient address. These helpers
 * turn a restaurant + a set of roles into the concrete, verified email
 * addresses of its members.
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

export interface Recipient {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/** Roles that should receive operational alerts (delays, reminders, approvals). */
export const MANAGER_ROLES: UserRole[] = ['owner', 'manager'];

/**
 * Reserved top-level domains (RFC 2606 / 6761): no mail to them can ever be
 * delivered. The demo tenant's members are @kfar-hazeitim.test, so in
 * production its reminders were queued, rejected by the provider, retried
 * five times and parked as failed (7.11). Production skips them instead.
 */
const RESERVED_TLD_RE = /(^|\.)(test|local|example|invalid|localhost)$/i;

/** True when `email` is on a reserved TLD and can never be delivered. */
export function isUndeliverableAddress(email: string): boolean {
  const domain = email.trim().split('@').pop() ?? '';
  return RESERVED_TLD_RE.test(domain.replace(/\.$/, ''));
}

/**
 * Member email addresses for a restaurant, optionally filtered by role.
 * De-duplicates by email (a user can hold several roles). Defaults to the
 * owner+manager set used for operational alerts.
 */
export async function recipientsForRestaurant(
  db: Database,
  restaurantId: string,
  roles: UserRole[] = MANAGER_ROLES,
  /** Production only: dev and test fixtures use reserved TLDs on purpose, and never send. */
  opts: { env?: NodeJS.ProcessEnv } = {},
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

  const skipReserved = (opts.env ?? process.env).NODE_ENV === 'production';
  const byEmail = new Map<string, Recipient>();
  for (const r of rows) {
    if (!r.email) continue;
    if (skipReserved && isUndeliverableAddress(r.email)) {
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
