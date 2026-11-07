import { and, eq, inventoryCounts, invoices, memberships, purchaseOrders, recoveryClaims, restaurants, suppliers, withRestaurant, type Database } from '@restomatch/db';

/**
 * `nav.whereIs` (W2-08, ia-nav-08): a record id that 404'd in the active branch
 * — is it in ANOTHER restaurant the viewer is a member of? Crosses tenants by
 * design, so it never uses the owner connection: it loops over the viewer's own
 * memberships with one `withRestaurant` each (RLS on). A foreign tenant and a
 * missing id give the identical answer (`{ found: false }`): no existence oracle.
 */
export const WHERE_IS_KINDS = ['invoice', 'po', 'supplier', 'claim', 'count'] as const;
export type WhereIsKind = (typeof WHERE_IS_KINDS)[number];

export type WhereIsResult = { found: false } | { found: true; restaurantId: string; name: string; path: string };

const TABLES = {
  invoice: invoices,
  po: purchaseOrders,
  supplier: suppliers,
  claim: recoveryClaims,
  count: inventoryCounts,
} as const;

export function pathFor(kind: WhereIsKind, id: string): string {
  switch (kind) {
    case 'invoice':
      return `/dashboard/invoices/${id}`;
    case 'po':
      return `/dashboard/orders/${id}`;
    case 'supplier':
      return `/dashboard/suppliers/${id}`;
    case 'claim':
      return `/dashboard/recovery?claim=${id}`;
    case 'count':
      return `/dashboard/inventory/${id}`;
  }
}

/** `db` is the user-scoped transaction (app.current_user_id set). */
export async function whereIs(
  db: Database,
  userId: string,
  activeRestaurantId: string | null,
  kind: WhereIsKind,
  id: string,
  deps: { scoped: typeof withRestaurant } = { scoped: withRestaurant },
): Promise<WhereIsResult> {
  const mine = await db
    .select({ restaurantId: memberships.restaurantId, name: restaurants.name })
    .from(memberships)
    .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
    .where(eq(memberships.userId, userId));
  const table = TABLES[kind];
  const ordered = [...mine].sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
  for (const m of ordered) {
    if (m.restaurantId === activeRestaurantId) continue;
    const hit = await deps.scoped(db, m.restaurantId, (tx) =>
      tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.restaurantId, m.restaurantId)))
        .limit(1),
    );
    if (hit.length > 0) return { found: true, restaurantId: m.restaurantId, name: m.name, path: pathFor(kind, id) };
  }
  return { found: false };
}
