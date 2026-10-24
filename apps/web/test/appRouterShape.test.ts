import type { inferRouterOutputs } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { appRouter, type AppRouter } from '@restomatch/api';

/**
 * Guard for the (historical) "tRPC AppRouter inference drops routers" report
 * that led to `typescript.ignoreBuildErrors` in next.config.ts. The flag is gone
 * (build + `tsc` type-check for real); this pins both halves of the contract:
 *
 *  - type level (checked by `tsc --noEmit` / `next build`): every key below must
 *    exist on the INFERRED client type, and none may be missing from the list;
 *  - runtime (vitest): the list equals the routers actually mounted.
 *
 * Adding a router = add its key here.
 */
type RouterKey = keyof inferRouterOutputs<AppRouter>;

const ROUTER_KEYS = [
  'activity',
  'admin',
  'approvals',
  'ask',
  'catalog',
  'chain',
  'consolidated',
  'contracts',
  'dsr',
  'exports',
  'growth',
  'ingest',
  'integrations',
  'leads',
  'leakCheck',
  'mapping',
  'match',
  'monthlyReport',
  'onboarding',
  'orders',
  'owner',
  'payRun',
  'plans',
  'priceAlerts',
  'products',
  'receiverLangs',
  'receiving',
  'recipes',
  'recovery',
  'scans',
  'search',
  'settings',
  'supplierConfirm',
  'suppliers',
  'team',
] as const satisfies readonly RouterKey[];

// Fails to compile if the inferred type has a router the list doesn't name.
type Unlisted = Exclude<RouterKey, (typeof ROUTER_KEYS)[number]>;
const exhaustive: [Unlisted] extends [never] ? true : Unlisted = true;

describe('AppRouter shape', () => {
  it('lists exactly the mounted routers', () => {
    expect(exhaustive).toBe(true);
    expect(Object.keys(appRouter._def.record).sort()).toEqual([...ROUTER_KEYS]);
  });
});
