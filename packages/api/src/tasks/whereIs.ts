import type { UserRole } from '@restomatch/db';
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

/**
 * Who may open each kind's page — mirrors the web route registry (pinned by
 * apps/web whereis-roles.test.ts). A membership whose role can't open the page
 * is not searched: no existence hint inside a branch either (warden, 11.11).
 */
export const KIND_ROLES: Record<WhereIsKind, readonly UserRole[]> = {
  invoice: ['owner', 'manager', 'bookkeeper'],
  po: ['owner', 'manager', 'chef'],
  supplier: ['owner', 'manager', 'bookkeeper'],
  claim: ['owner', 'manager', 'bookkeeper'],
  count: ['owner', 'manager', 'chef', 'bookkeeper'],
};

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
    .select({ restaurantId: memberships.restaurantId, name: restaurants.name, role: memberships.role })
    .from(memberships)
    .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
    .where(eq(memberships.userId, userId));
  const table = TABLES[kind];
  // One lookup per branch (a user may hold two roles in one branch), only where a role may open the page.
  const allowed = new Map<string, string>();
  for (const m of mine) if (KIND_ROLES[kind].includes(m.role)) allowed.set(m.restaurantId, m.name);
  const ordered = [...allowed].map(([restaurantId, name]) => ({ restaurantId, name })).sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
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
