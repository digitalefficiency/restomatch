import type { UserRole } from '@restomatch/db';

/** Roles whose loss (or the owner role's gain) is a guarded transition (W2-14). */
const POWER_ROLES: ReadonlySet<UserRole> = new Set(['owner', 'manager', 'bookkeeper']);
const RANK: Record<UserRole, number> = { owner: 4, manager: 3, bookkeeper: 2, chef: 1, receiver: 1 };

/**
 * A staged role change that needs the confirm step: promoting anyone to owner,
 * or moving an owner, manager or bookkeeper to a role of equal or lower rank
 * (they lose powers). Other changes save directly from the staged row.
 */
export function needsRoleConfirm(from: UserRole, to: UserRole): boolean {
  if (from === to) return false;
  if (to === 'owner') return true;
  return POWER_ROLES.has(from) && RANK[to] <= RANK[from];
}
