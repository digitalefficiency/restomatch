import 'server-only';
import { cache } from 'react';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { FINANCE_ROLES, MANAGER_ROLES } from './logic';

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
 * One non-throwing `contracts.access` call reports both flags + the open-alert
 * count; any error means "off", so every caller fails silent. Request-memoized
 * (layout + page + nav share one call). Receiver/chef never call it.
 */
export const getWave1Access = cache(async function getWave1Access(): Promise<Wave1Access> {
  const session = await auth();
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null;
  if (!role || !FINANCE_ROLES.includes(role)) return NONE;
  const caller = await createServerCaller();
  const flags = await caller.contracts.access().catch(() => null);
  if (!flags) return { ...NONE, finance: true, canManage: MANAGER_ROLES.includes(role) };
  return {
    finance: true,
    canManage: MANAGER_ROLES.includes(role),
    contracts: flags.contracts,
    priceAlerts: flags.priceAlerts,
    openAlerts: flags.openAlerts,
  };
});
