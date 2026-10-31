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
  discrepancies,
  eq,
  inArray,
  memberships,
  purchaseOrders,
  users,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { emailAddress, verifiedPhone, type Address } from './address';

type SQL = ReturnType<typeof eq>;

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
): Promise<Recipient[]> {
  if (roles.length === 0) return [];

  const rows = await memberRows(db, restaurantId, inArray(memberships.role, roles));

  const byEmail = new Map<string, Recipient>();
  for (const r of rows) {
    if (!r.email) continue;
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

/**
 * The one membership query (memberships ⨝ users), always scoped to ONE
 * restaurant. Both `recipientsForRestaurant` and `resolveAudience` use it.
 */
async function memberRows(db: Database, restaurantId: string, filter: SQL) {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      phone: users.phone,
      locale: memberships.preferredLocale,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.restaurantId, restaurantId), filter));
}

/**
 * Who a notification is for. Resolved at enqueue time, inside ONE restaurant,
 * to real people. There is deliberately no `role:` string form.
 */
export type Audience =
  | { userIds: readonly string[] }
  | { roles: readonly UserRole[] }
  /** The user who created (sent) a purchase order of this restaurant. */
  | { poSenderOf: string }
  /** The people who decide on a discrepancy of this restaurant (owner + manager). */
  | { decidersOf: string };

export const DECIDER_ROLES: UserRole[] = ['owner', 'manager'];

export interface AudienceMember {
  userId: string;
  role: UserRole;
  locale: 'he' | 'en';
  addresses: Address[];
}

/**
 * Interim until G-03 deploys `users.phone_verified_at` (+ W2-14's OTP): no
 * phone counts as verified, so nobody gets a WhatsApp row. Swap this one
 * function to read the column.
 */
function phoneVerifiedAtOf(_row: { phone: string | null }): Date | null {
  return null;
}

/**
 * Resolve an audience to members of `restaurantId` with their verified
 * addresses (e-mail always when valid; WhatsApp only with a verified phone; push
 * once H-03 lands). A user of another restaurant resolves to nothing. One entry
 * per user (a user holds one membership per restaurant).
 */
export async function resolveAudience(
  db: Database,
  restaurantId: string,
  audience: Audience,
): Promise<AudienceMember[]> {
  let filter: SQL | undefined;
  if ('roles' in audience) {
    if (audience.roles.length === 0) return [];
    filter = inArray(memberships.role, [...audience.roles]);
  } else if ('userIds' in audience) {
    const ids = [...new Set(audience.userIds.filter(Boolean))];
    if (ids.length === 0) return [];
    filter = inArray(memberships.userId, ids);
  } else if ('poSenderOf' in audience) {
    const [po] = await db
      .select({ createdBy: purchaseOrders.createdBy })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, audience.poSenderOf), eq(purchaseOrders.restaurantId, restaurantId)))
      .limit(1);
    if (!po?.createdBy) return [];
    filter = eq(memberships.userId, po.createdBy);
  } else {
    const [d] = await db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .where(and(eq(discrepancies.id, audience.decidersOf), eq(discrepancies.restaurantId, restaurantId)))
      .limit(1);
    if (!d) return [];
    filter = inArray(memberships.role, DECIDER_ROLES);
  }

  const rows = await memberRows(db, restaurantId, filter);
  const out = new Map<string, AudienceMember>();
  for (const r of rows) {
    if (out.has(r.userId)) continue;
    const addresses: Address[] = [];
    const email = emailAddress(r.email);
    if (email) addresses.push(email);
    const phone = verifiedPhone(r.phone, phoneVerifiedAtOf(r));
    if (phone) addresses.push(phone);
    out.set(r.userId, {
      userId: r.userId,
      role: r.role,
      locale: r.locale === 'en' ? 'en' : 'he',
      addresses,
    });
  }
  return [...out.values()];
}
