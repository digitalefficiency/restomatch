/**
 * Feature seeds that run AFTER the core demo seed (seed → seed-demo → seed-chain-demo):
 * one entry per feature dataset, in run order. `reseed:demo` runs each one whose
 * script and table exist on this checkout, and `check-demo` asserts its data, so a
 * production reseed never leaves a feature's screens empty.
 *
 * The contract every step's script must keep (asserted by reseed-demo):
 *   - writes ONLY to the demo tenants. reseed-demo passes DEMO_RESTAURANT_ID (the main
 *     demo restaurant) and DEMO_RESTAURANT_IDS (main + branches, comma-separated);
 *     on a remote database a step whose source never reads either of them (or
 *     findDemoTenants / DEMO_MAIN_BUSINESS_ID) is refused — "the oldest restaurant"
 *     or "every restaurant" is a real tenant there;
 *   - is idempotent and anchored to DEMO_TODAY;
 *   - never touches invoices or discrepancies: the leak hero is snapshotted before
 *     the extras and must be identical after them.
 */
import type postgres from 'postgres';

export interface DemoExtraStep {
  key: string;
  label: string;
  /** Candidate script paths under apps/worker; the first that exists runs. */
  scripts: string[];
  /** Skipped when this table does not exist (the feature's migration is not here). */
  requiresTable: string;
  /** Read-only assertions on the seeded data (check-demo). */
  check: (sql: postgres.Sql, rids: string[], mainId: string) => Promise<{ facts: string[]; problems: string[] }>;
}

const count = async (query: Promise<unknown>) => Number(((await query) as Array<{ n: number }>)[0]?.n ?? 0);

export const DEMO_EXTRA_STEPS: DemoExtraStep[] = [
  {
    key: 'recovery',
    label: '₪-back recovery states (S12)',
    scripts: ['scripts/seed-recovery-demo.ts'],
    requiresTable: 'recovery_claims',
    async check(sql, _rids, mainId) {
      const claims = await count(sql`select count(*)::int as n from recovery_claims where restaurant_id = ${mainId}`);
      const staged = await count(sql`select count(*)::int as n from recovery_claims where restaurant_id = ${mainId} and status <> 'claimed'`);
      const problems: string[] = [];
      if (claims === 0) problems.push('recovery: the main demo restaurant has no recovery claims (₪-back tracker empty)');
      else if (staged === 0) problems.push('recovery: claims exist but none is staged past "claimed" (seed-recovery-demo did not run)');
      return { facts: [`recovery: ${claims} claims, ${staged} staged`], problems };
    },
  },
  {
    key: 'recipes',
    label: 'recipes / food cost per dish (S17)',
    scripts: ['scripts/seed-recipes-demo.ts'],
    requiresTable: 'recipes',
    async check(sql, _rids, mainId) {
      const recipes = await count(sql`select count(*)::int as n from recipes where restaurant_id = ${mainId}`);
      const items = await count(sql`select count(*)::int as n from recipe_items where restaurant_id = ${mainId}`);
      const problems: string[] = [];
      if (recipes === 0 || items === 0) problems.push(`recipes: ${recipes} recipes / ${items} items on the main demo restaurant (food cost page empty)`);
      return { facts: [`recipes: ${recipes} dishes, ${items} items`], problems };
    },
  },
  {
    key: 'contracts',
    label: 'contract price lists + price alerts (S11)',
    scripts: ['scripts/seed-wave1-contracts-demo.ts', 'scripts/seed-contracts-demo.ts'],
    requiresTable: 'supplier_contract_prices',
    async check(sql, _rids, mainId) {
      const prices = await count(sql`select count(*)::int as n from supplier_contract_prices where restaurant_id = ${mainId}`);
      const alerts = await count(sql`select count(*)::int as n from price_alerts where restaurant_id = ${mainId}`);
      const problems: string[] = [];
      if (prices === 0) problems.push('contracts: no contract prices on the main demo restaurant (contracts page / over-contract card empty)');
      if (alerts === 0) problems.push('contracts: no price alerts on the main demo restaurant (price-alert tab empty)');
      return { facts: [`contracts: ${prices} contract prices, ${alerts} price alerts`], problems };
    },
  },
];

/** True when a step's script reads the demo-tenant scope reseed-demo hands it. */
export function scriptIsDemoScoped(source: string): boolean {
  return /DEMO_RESTAURANT_IDS?\b|findDemoTenants|DEMO_MAIN_BUSINESS_ID/.test(source);
}
