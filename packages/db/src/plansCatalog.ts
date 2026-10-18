import { PLAN_SEED_LIST } from './plans';

/**
 * The plan catalog as SQL (migration 0033_plans_catalog), generated from
 * PLAN_SEED — the single source of truth for pricing/limits/features. A fresh
 * project built from migrations otherwise has an empty `plans` table (only the
 * demo seed filled it), so /pricing rendered zero cards and entitlements had no
 * plan to resolve. Idempotent upsert keyed on plans.key. The shape test asserts
 * the committed migration equals this output and that the rows equal PLAN_SEED.
 */
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function plansCatalogSql(): string {
  const rows = PLAN_SEED_LIST.map(
    (p) =>
      `  (${q(p.key)}, ${q(p.nameHe)}, ${p.priceAgorotMonthly}, ${q(JSON.stringify(p.limits))}::jsonb, ` +
      `array[${p.features.map(q).join(', ')}]::text[], ${p.sortOrder})`,
  ).join(',\n');
  return `-- 0033 — the plan catalog (F8, client-ready). GENERATED from packages/db/src/plans.ts
-- (PLAN_SEED) by plansCatalogSql() — change PLAN_SEED, then add a NEW migration;
-- never edit this file after release.
--
-- A database built purely from migrations (the new Supabase project) had no plans,
-- so /pricing showed no cards and entitlements could not resolve a plan. Upsert on
-- plans.key: inserts the catalog on a fresh database and re-prices an existing one
-- to PLAN_SEED (the demo seed did the same). No precondition.
--
-- Hand-written (drizzle-kit generate is broken in this repo).
INSERT INTO "plans" ("key", "name_he", "price_agorot_monthly", "limits", "features", "sort_order") VALUES
${rows}
ON CONFLICT ("key") DO UPDATE SET
  "name_he" = EXCLUDED."name_he",
  "price_agorot_monthly" = EXCLUDED."price_agorot_monthly",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features",
  "sort_order" = EXCLUDED."sort_order";
`;
}
