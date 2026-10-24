import type { UserRole } from '@restomatch/db';

/** Whose approval queue a role sees: owner sees everyone's; manager / bookkeeper only their own. */
export function expandVisibleRoles(role: UserRole): UserRole[] {
  switch (role) {
    case 'owner':
      return ['owner', 'manager', 'bookkeeper'];
    case 'manager':
      return ['manager'];
    case 'bookkeeper':
      return ['bookkeeper'];
    default:
      return [role];
  }
}

/**
 * May `role` decide a discrepancy routed to `requiredRole`? No required role →
 * owner / manager (not a bookkeeper, whose authority is limited to
 * bookkeeper-routed items). The rule approvals.ensureCanAct enforces.
 */
export function canActOn(role: UserRole, requiredRole: UserRole | null): boolean {
  if (!requiredRole) return role === 'owner' || role === 'manager';
  return expandVisibleRoles(role).includes(requiredRole);
}
