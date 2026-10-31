import type { UserRole } from '@restomatch/db';
import type { createServerCaller } from '@/lib/trpc/server';

export type Caller = Awaited<ReturnType<typeof createServerCaller>>;

/**
 * The tRPC namespaces each role's home may read. Staff homes (receiver, chef)
 * never get `owner` — so the restaurant's leak, spend and KPI money are not even
 * requested for them (owner decision §8.6 default: staff do not see purchase or
 * leak totals). Enforced twice: by the type (no `owner` key on a staff caller)
 * and at runtime (an unlisted namespace reads as undefined).
 */
export const HOME_NAMESPACES = {
  receiver: ['receiving'],
  chef: ['inventory', 'recipes'],
  manager: ['approvals', 'receiving', 'inventory', 'suppliers', 'owner', 'activity'],
  bookkeeper: ['approvals', 'payRun', 'owner', 'recovery', 'activity'],
  owner: ['approvals', 'owner', 'recovery', 'payRun', 'activity', 'receiving'],
} as const satisfies Record<UserRole, readonly (keyof Caller)[]>;

export type HomeCaller<R extends UserRole> = Pick<Caller, (typeof HOME_NAMESPACES)[R][number]>;

/** A view of `caller` limited to the role's home namespaces. */
export function homeCaller<R extends UserRole>(caller: Caller, role: R): HomeCaller<R> {
  const allowed = new Set<string>(HOME_NAMESPACES[role]);
  return new Proxy(caller, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !allowed.has(prop)) return undefined;
      return Reflect.get(target, prop, receiver);
    },
  }) as HomeCaller<R>;
}

/** Procedures that expose the restaurant's money totals (leak, spend, KPIs). */
export const OWNER_MONEY_PROCEDURES = ['owner.kpis', 'owner.leakHero', 'owner.leakSummary'] as const;
