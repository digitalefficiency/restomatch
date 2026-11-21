import { REGISTRY } from './registry';
import type { BadgeKey, RouteDef } from './types';

/**
 * Which registry entry shows which `nav.badges` source (W2-08), for entries
 * whose `routes/<seg>.ts` belongs to another wave-2 package. An entry's own
 * `badge` key wins (a route owner moves it there on their next rebase; then the
 * line here goes). Edge-safe: pure data.
 */
export const DEFAULT_ROUTE_BADGES: Readonly<Partial<Record<string, BadgeKey>>> = {
  approvals: 'approvals', // W2-04 routes/approvals.ts
  payRun: 'payRun', // W2-03 (routes/approvals.ts)
  recovery: 'claims', // W2-10 routes/recovery.ts
  receiving: 'receiving', // W2-05 routes/receiving.ts
  inventory: 'count', // W2-07 routes/inventory.ts (the open count shows on its parent item)
  inbox: 'intake', // W2-02 routes/inbox.ts
  contracts: 'priceAlerts', // W2-12 routes/contracts.ts
};

/** The badge source a registry entry shows, or null. */
export function badgeFor(def: Pick<RouteDef, 'key' | 'badge'>): BadgeKey | null {
  if (def.badge !== undefined) return def.badge;
  return DEFAULT_ROUTE_BADGES[def.key] ?? null;
}

/** Route key → badge key, for every registry entry that shows one. */
export function routeBadgeMap(): Record<string, BadgeKey> {
  const out: Record<string, BadgeKey> = {};
  for (const r of REGISTRY) {
    const b = badgeFor(r);
    if (b) out[r.key] = b;
  }
  return out;
}
