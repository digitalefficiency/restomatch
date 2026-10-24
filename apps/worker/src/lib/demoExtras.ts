/**
 * Feature seeds that run AFTER the core demo seed (seed → seed-demo → seed-chain-demo):
 * one entry per feature dataset, in run order (inventory reads recovery's credit notes,
 * so it runs after it). `reseed:demo` runs each one whose
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
  check: (sql: postgres.Sql, rids: string[], mainId: string, url: string) => Promise<{ facts: string[]; problems: string[] }>;
}

/** S12's seeded ₪-back claims on the main demo restaurant (DEMO_TODAY 2026-10-25). */
export const EXPECTED_RECOVERY = { claims: 74, claimedAgorot: 367_210 };
/** S11's contract prices (HaKerem 6 + Mediterranean Fish 4) and the one open tomato alert. */
export const EXPECTED_CONTRACTS = { prices: 10, alerts: 1 };
/** October's actual food cost on the demo (S17): ₪36,247.99 of ₪136,400 food sales. */
export const EXPECTED_ACTUAL_FOOD_COST_PCT = '26.6';

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
      const claimedAgorot = await count(sql`select coalesce(sum(amount_agorot), 0)::bigint as n from recovery_claims where restaurant_id = ${mainId}`);
      const problems: string[] = [];
      if (claims === 0) problems.push('recovery: the main demo restaurant has no recovery claims (₪-back tracker empty)');
      else if (staged === 0) problems.push('recovery: claims exist but none is staged past "claimed" (seed-recovery-demo did not run)');
      if (claims !== EXPECTED_RECOVERY.claims || claimedAgorot !== EXPECTED_RECOVERY.claimedAgorot) {
        problems.push(`recovery: ${claims} claims / ₪${(claimedAgorot / 100).toFixed(2)} claimed, expected ${EXPECTED_RECOVERY.claims} / ₪${(EXPECTED_RECOVERY.claimedAgorot / 100).toFixed(2)}`);
      }
      return { facts: [`recovery: ${claims} claims (₪${(claimedAgorot / 100).toFixed(2)}), ${staged} staged`], problems };
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
    key: 'inventory',
    label: 'inventory counts → actual food cost (S17)',
    scripts: ['scripts/seed-inventory-demo.ts'],
    requiresTable: 'inventory_counts',
    async check(sql, _rids, mainId, url) {
      const rows = (await sql`
        select count_date::text as d, total_value_agorot::text as v, food_sales_ex_vat::text as sales
        from inventory_counts where restaurant_id = ${mainId} and status = 'completed' order by count_date
      `) as unknown as Array<{ d: string; v: string; sales: string | null }>;
      const drafts = await count(sql`select count(*)::int as n from inventory_counts where restaurant_id = ${mainId} and status = 'draft'`);
      const problems: string[] = [];
      if (drafts > 0) problems.push(`inventory: ${drafts} draft count(s) left open on the main demo restaurant — the count screen would resume a half-done count`);
      if (rows.length < 2) problems.push(`inventory: ${rows.length} completed count(s) on the main demo restaurant — the actual food cost needs an opening and a closing count`);
      else if (rows[rows.length - 1]!.sales == null) problems.push('inventory: the closing count has no food sales — the actual food cost % cannot show');
      const facts = [`inventory: ${rows.map((r) => `${r.d} ₪${(Number(r.v) / 100).toFixed(2)}${r.sales ? ` (sales ₪${r.sales})` : ''}`).join(', ') || 'no completed counts'}`];
      // The figure the screen shows, through the same router the page uses.
      const [owner] = (await sql`select user_id as id from memberships where restaurant_id = ${mainId} and role = 'owner' limit 1`) as unknown as Array<{ id: string }>;
      if (rows.length >= 2 && owner) {
        const { appRouter } = await import('@restomatch/api');
        const { createDb } = await import('@restomatch/db');
        const caller = appRouter.createCaller({ db: createDb(url), session: { userId: owner.id, restaurantId: mainId, role: 'owner' } } as never) as unknown as {
          inventory?: { period: () => Promise<{ available: boolean; actualAgorot?: number; salesAgorot?: number | null; actualBp?: number | null }> };
        };
        // A tRPC caller is a proxy: a missing router throws "No procedure found" on call.
        const p = await caller.inventory?.period().catch((e: unknown) => {
          if (String(e).includes('No procedure found')) return undefined;
          throw e;
        });
        if (!p) {
          facts.push('inventory: no inventory router on this checkout — the food cost % is not checked');
          return { facts, problems };
        }
        const pct = p?.available && p.actualBp != null ? (p.actualBp / 100).toFixed(1) : null;
        facts.push(`inventory: actual food cost ${pct ?? '—'}% (₪${((p?.actualAgorot ?? 0) / 100).toFixed(2)} of ₪${((p?.salesAgorot ?? 0) / 100).toFixed(2)})`);
        if (pct !== EXPECTED_ACTUAL_FOOD_COST_PCT) problems.push(`inventory: actual food cost reads ${pct ?? '—'}%, expected ${EXPECTED_ACTUAL_FOOD_COST_PCT}%`);
      }
      return { facts, problems };
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
      if (prices !== EXPECTED_CONTRACTS.prices) problems.push(`contracts: ${prices} contract prices on the main demo restaurant, expected ${EXPECTED_CONTRACTS.prices} (contracts page / over-contract card)`);
      if (alerts !== EXPECTED_CONTRACTS.alerts) problems.push(`contracts: ${alerts} price alerts on the main demo restaurant, expected ${EXPECTED_CONTRACTS.alerts} (price-alert tab)`);
      return { facts: [`contracts: ${prices} contract prices, ${alerts} price alerts`], problems };
    },
  },
];

/** True when a step's script reads the demo-tenant scope reseed-demo hands it. */
export function scriptIsDemoScoped(source: string): boolean {
  return /DEMO_RESTAURANT_IDS?\b|findDemoTenants|DEMO_MAIN_BUSINESS_ID/.test(source);
}
