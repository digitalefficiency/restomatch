'use server';

import { TRPCError } from '@trpc/server';
import { NOT_BILLING_OWNER } from '@restomatch/api';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, unstable_update } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';

/**
 * Branch (restaurant) server actions. None of them trusts a restaurant id from
 * the browser: the chain router re-checks it against the caller's memberships
 * under RLS, and the session switch is re-validated again by the jwt callback
 * (lib/activeRestaurant.ts) against the DB memberships.
 */

export type BranchActionError = 'notFound' | 'forbidden' | 'notPayer' | 'limit' | 'nameInvalid' | 'generic';
export type BranchActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: BranchActionError };

function errorOf(err: unknown): BranchActionError {
  if (err instanceof TRPCError) {
    if (err.code === 'NOT_FOUND') return 'notFound';
    if (err.code === 'BAD_REQUEST') return 'nameInvalid';
    if (err.code === 'FORBIDDEN') {
      if (err.message === NOT_BILLING_OWNER) return 'notPayer';
      return err.message.startsWith('ENTITLEMENT_REQUIRED') ? 'limit' : 'forbidden';
    }
  }
  return 'generic';
}

/** Make `restaurantId` the active branch (the client then lands on its overview). */
export async function switchBranchAction(restaurantId: string): Promise<BranchActionResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  try {
    const caller = await createServerCaller();
    await caller.chain.switchTarget({ restaurantId });
  } catch (err) {
    return { ok: false, error: errorOf(err) };
  }
  await unstable_update({ activeRestaurantId: restaurantId } as unknown as Parameters<typeof unstable_update>[0]);
  // No revalidatePath: the caller does a full document navigation to /dashboard
  // (BranchSwitcher / SwitchBranchButton), which renders fresh anyway. A
  // revalidation would push an RSC refresh into the page that is being torn
  // down by that navigation (a suspected source of the intermittent React #418).
  return { ok: true };
}

export async function addBranchAction(input: {
  name: string;
  copySuppliers: boolean;
  copyCatalog: boolean;
  copySettings: boolean;
}): Promise<BranchActionResult<{ restaurantId: string; name: string; suppliers: number; products: number }>> {
  try {
    const caller = await createServerCaller();
    const res = await caller.chain.addBranch({
      name: String(input.name ?? ''),
      copySuppliers: input.copySuppliers === true,
      copyCatalog: input.copyCatalog === true,
      copySettings: input.copySettings === true,
    });
    // No revalidatePath: the form follows up with a full navigation (same reason as above).
    return {
      ok: true,
      restaurantId: res.restaurantId,
      name: res.name,
      suppliers: res.copied.suppliers,
      products: res.copied.products,
    };
  } catch (err) {
    return { ok: false, error: errorOf(err) };
  }
}

export async function renameBranchAction(restaurantId: string, name: string): Promise<BranchActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.chain.renameBranch({ restaurantId, name: String(name ?? '') });
    revalidatePath('/dashboard', 'layout');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorOf(err) };
  }
}
