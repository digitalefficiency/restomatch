import { and, eq, memberships, ne, purchaseOrders, users, withRestaurant, type Database } from '@restomatch/db';
import { resolveSupplierToken } from '@restomatch/api';
import { contactNumbers } from './logic';

export interface PortalContact {
  name: string | null;
  tel: string;
  wa: string;
}

/**
 * Who the supplier can call about this order (auth-16): the person who placed
 * it, while they are STILL a member of the ordering restaurant and the order is
 * not cancelled. Nothing else: name + phone only (never the email).
 *
 * This is a NEW disclosure — the S5 order document that carries the portal link
 * does not print the orderer's phone — so it is deliberately narrow:
 *  1. the token resolves exactly as the portal does (unknown / revoked /
 *     flag-off / expired → null);
 *  2. the order is read under RLS inside the link's tenant (cancelled → null);
 *  3. a second query WITHOUT a tenant scope, on the identity connection (the
 *     app role sees only its own users row): read-only, name + phone, and only
 *     through a membership of THIS restaurant — a member who left is never shown.
 *
 * TODO(H-03): once restaurants.contact_phone exists, show the restaurant's own
 * number here instead of a person's.
 */
export async function lookupPortalContact(
  conn: { adminDb: Database; db: Database },
  token: string,
  now: Date = new Date(),
): Promise<PortalContact | null> {
  const r = await resolveSupplierToken(conn.adminDb, token, now);
  if (!r.ok) return null;
  const { restaurantId, poId } = r.link;
  const [po] = await withRestaurant(conn.db, restaurantId, (tx) =>
    tx
      .select({ createdBy: purchaseOrders.createdBy })
      .from(purchaseOrders)
      .where(
        and(eq(purchaseOrders.id, poId), eq(purchaseOrders.restaurantId, restaurantId), ne(purchaseOrders.status, 'cancelled')),
      )
      .limit(1),
  );
  if (!po?.createdBy) return null;
  const [u] = await conn.adminDb
    .select({ name: users.name, phone: users.phone })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.restaurantId, restaurantId)))
    .where(eq(users.id, po.createdBy))
    .limit(1);
  const numbers = contactNumbers(u?.phone);
  return numbers ? { name: u?.name?.trim() || null, ...numbers } : null;
}
