import 'server-only';
import {
  loadSupplierOrder,
  resolveSupplierToken,
  submitSupplierAnswer,
  type SupplierAnswerInput,
  type SupplierOrderView,
} from '@restomatch/api';
import { withRestaurant } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { db } from '@/lib/db';

/**
 * The public portal's data access. The token → (restaurant, order) lookup is the
 * single query on the RLS-bypassing auth connection (there is no tenant yet);
 * reading the order and writing the answer run as the RLS app role inside the
 * link's tenant transaction.
 */
export async function supplierPortalView(
  token: string,
): Promise<{ ok: true; view: SupplierOrderView } | { ok: false; error: 'NOT_FOUND' | 'EXPIRED' }> {
  const r = await resolveSupplierToken(authDb, token);
  if (!r.ok) return r;
  const view = await withRestaurant(db, r.link.restaurantId, (tx) => loadSupplierOrder(tx, r.link));
  return view ? { ok: true, view } : { ok: false, error: 'NOT_FOUND' };
}

export async function supplierPortalSubmit(token: string, input: SupplierAnswerInput) {
  const r = await resolveSupplierToken(authDb, token);
  if (!r.ok) return r;
  return withRestaurant(db, r.link.restaurantId, (tx) => submitSupplierAnswer(tx, r.link, input));
}
