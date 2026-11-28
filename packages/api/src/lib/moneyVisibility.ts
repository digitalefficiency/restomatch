import type { UserRole } from '@restomatch/db';

/**
 * H-11 · least-privilege money visibility (owner decision 6; wave-2 README §7).
 *
 * The receiver and the chef see no purchase or leak ₪. The chef is exempt on
 * the orders screens (`orders.*`, plus the catalog list prices the order wizard
 * reads) and on recipes. Owner, manager and bookkeeper read everything.
 *
 * A stripped field comes back as `null` with its key kept, so response shapes
 * and counts stay the same. G-07's capability table supersedes this module.
 */
export type MoneyArea = 'orders' | 'recipes' | 'general';

const NO_MONEY_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['receiver', 'chef']);
const CHEF_MONEY_AREAS: ReadonlySet<MoneyArea> = new Set<MoneyArea>(['orders', 'recipes']);

/** True when this role may read ₪ in this area. */
export function seesMoney(role: UserRole, area: MoneyArea = 'general'): boolean {
  if (!NO_MONEY_ROLES.has(role)) return true;
  return role === 'chef' && CHEF_MONEY_AREAS.has(area);
}

/** `value` when the role sees ₪ in the area, else `null`. */
export function moneyOrNull<T>(role: UserRole, area: MoneyArea, value: T): T | null {
  return seesMoney(role, area) ? value : null;
}
