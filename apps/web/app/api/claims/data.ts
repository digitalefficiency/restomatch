import 'server-only';
import { claimPortal } from '@restomatch/api';
import { withRestaurant } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { db } from '@/lib/db';

/**
 * H-06ʰ data access for the supplier's reply link. The token → link check is
 * pure crypto plus ONE read of the restaurant's flag on the RLS-bypassing auth
 * connection (there is no tenant yet); the letter read and the answer write run
 * as the RLS app role inside the link's tenant transaction.
 */
export async function claimLetterView(token: string) {
  const r = await claimPortal.resolveClaimLink(authDb, token);
  if (!r.ok) return r;
  const view = await withRestaurant(db, r.link.restaurantId, (tx) => claimPortal.loadClaimLetter(tx, r.link));
  return view ? ({ ok: true, view } as const) : ({ ok: false, error: 'NOT_FOUND' } as const);
}

export async function claimLetterSubmit(token: string, input: claimPortal.ClaimAnswerInput) {
  const r = await claimPortal.resolveClaimLink(authDb, token);
  if (!r.ok) return r;
  return withRestaurant(db, r.link.restaurantId, (tx) => claimPortal.submitClaimAnswer(tx, r.link, input));
}
