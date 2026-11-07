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
  if (!view) return { ok: false, error: 'NOT_FOUND' };
  // A cancelled or closed order takes no new answer: the link reads as no longer
  // active. An answer already on record is still shown.
  if (!view.confirmable && !view.response) return { ok: false, error: 'EXPIRED' };
  return { ok: true, view };
}

/** The portal's answer: unlike the service type, the intent is REQUIRED here (G-10). */
export type PortalAnswerInput = SupplierAnswerInput & Required<Pick<SupplierAnswerInput, 'intent' | 'linesVersion'>>;

export async function supplierPortalSubmit(token: string, input: PortalAnswerInput) {
  const r = await resolveSupplierToken(authDb, token);
  if (!r.ok) return r;
  return withRestaurant(db, r.link.restaurantId, (tx) => submitSupplierAnswer(tx, r.link, input));
}
