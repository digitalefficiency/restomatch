import type { UserRole } from '@restomatch/db';

/**
 * WHO SEES vs WHO DECIDES (G-07). Two explicit tables instead of one function
 * that conflated them: widening who *reads* an approval item must never widen
 * who may *decide* it ("widening who sees silently widens who decides").
 *
 * `'unrouted'` = an item with no `requiredRole` (owner / manager decide it).
 */
export type Routing = UserRole | 'unrouted';

export const USER_ROLES = ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'] as const satisfies ReadonlyArray<UserRole>;
export const ROUTINGS = [...USER_ROLES, 'unrouted'] as const satisfies ReadonlyArray<Routing>;

/**
 * Which routings a role may READ in the approval queue. Owner, manager and
 * bookkeeper read everything (the bookkeeper runs the month: exec-desktop-03;
 * the manager must see the ₪ waiting on the owner: functional-flows-07).
 * Receiver and chef read no approval items (no purchase / leak ₪).
 *
 * Adopted by W2-04 (`myQueue` scope `all` + `canAct` / `waitingOn`). Until then
 * `myQueue` keeps `expandVisibleRoles` (unchanged behaviour).
 */
export const VISIBLE_TO: Readonly<Record<UserRole, ReadonlyArray<Routing>>> = {
  owner: ROUTINGS,
  manager: ROUTINGS,
  bookkeeper: ROUTINGS,
  receiver: [],
  chef: [],
};

/**
 * Which routings a role may DECIDE. Byte-identical in effect to the wave-1
 * `canActOn`: owner → owner|manager|bookkeeper|unrouted; manager →
 * manager|unrouted; bookkeeper → bookkeeper only. Receiver / chef keep the
 * legacy self-routing (`expandVisibleRoles` returned `[role]`) so all 30
 * role × routing pairs stay identical; it is unreachable in practice (the
 * approvals engine routes only to owner | manager | bookkeeper | null, and
 * every decide procedure is above the receiver / chef tier).
 */
export const ACT_ON: Readonly<Record<UserRole, ReadonlyArray<Routing>>> = {
  owner: ['owner', 'manager', 'bookkeeper', 'unrouted'],
  manager: ['manager', 'unrouted'],
  bookkeeper: ['bookkeeper'],
  // Parity with wave 1 only — unreachable via the engine; removing them is a separate change.
  receiver: ['receiver'],
  chef: ['chef'],
};

/** May `role` read an item routed to `requiredRole` (null = unrouted)? */
export function canSee(role: UserRole, requiredRole: UserRole | null): boolean {
  return VISIBLE_TO[role].includes(requiredRole ?? 'unrouted');
}

/**
 * Whose approval queue a role sees: owner sees everyone's; manager / bookkeeper
 * only their own.
 *
 * @deprecated Kept byte-identical so `approvals.myQueue` / `queueSummary` do not
 * change until W2-04 adopts `VISIBLE_TO` (read) + `ACT_ON` (decide). New code
 * must use `canSee` / `canActOn`.
 */
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
 * Signature frozen (match/persist.ts decision carry-over).
 */
export function canActOn(role: UserRole, requiredRole: UserRole | null): boolean {
  return ACT_ON[role].includes(requiredRole ?? 'unrouted');
}
