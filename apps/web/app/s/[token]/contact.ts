import 'server-only';
import { and, eq, purchaseOrders, users, withRestaurant } from '@restomatch/db';
import { resolveSupplierToken } from '@restomatch/api';
import { authDb } from '@/lib/authDb';
import { db } from '@/lib/db';
import { contactNumbers } from './logic';

/**
 * Who the supplier can call about this order (auth-16): the person who placed
 * it — the same name + phone the order document (WhatsApp / email) already
 * prints for the supplier (routers/orders.ts renderSupplierMessage). The order
 * is read under RLS in the link's tenant; only the orderer's own users row is
 * read on the identity connection (the app role sees only its own user). No
 * phone on file → null, and the portal shows no call/WhatsApp buttons.
 */
export async function portalContact(token: string): Promise<{ name: string | null; tel: string; wa: string } | null> {
  const r = await resolveSupplierToken(authDb, token);
  if (!r.ok) return null;
  const [po] = await withRestaurant(db, r.link.restaurantId, (tx) =>
    tx
      .select({ createdBy: purchaseOrders.createdBy })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, r.link.poId), eq(purchaseOrders.restaurantId, r.link.restaurantId)))
      .limit(1),
  );
  if (!po?.createdBy) return null;
  const [u] = await authDb
    .select({ name: users.name, phone: users.phone })
    .from(users)
    .where(eq(users.id, po.createdBy))
    .limit(1);
  const numbers = contactNumbers(u?.phone);
  return numbers ? { name: u?.name?.trim() || null, ...numbers } : null;
}
