import 'server-only';
import { cache } from 'react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { FINANCE_ROLES, MANAGER_ROLES } from './logic';

/** Matches no supplier: a feature-gated, zero-row probe of `contracts.list`. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface Wave1Access {
  /** owner / manager / bookkeeper — may read contracts + alerts. */
  finance: boolean;
  /** owner / manager — may write (create/import/dismiss/thresholds). */
  canManage: boolean;
  contracts: boolean;
  priceAlerts: boolean;
  /** Open price-alert count (0 when the flag is off). */
  openAlerts: number;
}

const NONE: Wave1Access = { finance: false, canManage: false, contracts: false, priceAlerts: false, openAlerts: 0 };

/**
 * Which wave-1 surfaces (contracts / priceAlerts) this request may show.
 *
 * No procedure exposes the restaurant's feature flags, so each flag is probed
 * through a cheap, feature-gated procedure of its own router: any error
 * (FEATURE_DISABLED, a role FORBIDDEN, anything else) means "off" — every
 * caller of this helper fails silent. Request-memoized (layout + page + nav
 * share one probe). Receiver/chef never probe (they can't read either router).
 */
export const getWave1Access = cache(async function getWave1Access(): Promise<Wave1Access> {
  const session = await auth();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  if (!role || !FINANCE_ROLES.includes(role)) return NONE;
  const caller = await createServerCaller();
  const [contracts, openAlerts] = await Promise.all([
    caller.contracts.list({ supplierId: NIL_UUID }).then(
      () => true,
      () => false,
    ),
    caller.priceAlerts.openCount().then(
      (r) => r.count,
      () => null,
    ),
  ]);
  return {
    finance: true,
    canManage: MANAGER_ROLES.includes(role),
    contracts,
    priceAlerts: openAlerts !== null,
    openAlerts: openAlerts ?? 0,
  };
});
