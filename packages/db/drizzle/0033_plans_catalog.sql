-- 0033 — the plan catalog (F8, client-ready). GENERATED from packages/db/src/plans.ts
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
  ('trial', 'ניסיון', 0, '{"invoicesPerMonth":100,"restaurants":1,"seatsPerRestaurant":5}'::jsonb, array['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export']::text[], 0),
  ('basic', 'בסיס', 34900, '{"invoicesPerMonth":150,"restaurants":1,"seatsPerRestaurant":5}'::jsonb, array[]::text[], 1),
  ('pro', 'מקצועי', 59000, '{"invoicesPerMonth":400,"restaurants":1,"seatsPerRestaurant":10}'::jsonb, array['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export']::text[], 2),
  ('chain', 'רשת', 149000, '{"invoicesPerMonth":1500,"restaurants":5,"seatsPerRestaurant":25}'::jsonb, array['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export']::text[], 3)
ON CONFLICT ("key") DO UPDATE SET
  "name_he" = EXCLUDED."name_he",
  "price_agorot_monthly" = EXCLUDED."price_agorot_monthly",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features",
  "sort_order" = EXCLUDED."sort_order";
