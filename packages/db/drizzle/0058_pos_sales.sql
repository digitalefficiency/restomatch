-- 0058_pos_sales (S5 wave-1 integrations, flag `integrations`)
--
-- POS sales import: the hook S17's food-cost-per-dish reads (what was sold, how
-- many, for how much). File-based for now (CSV adapter); a POS API provider
-- writes the same rows later.
--
-- pos_sales_imports  one uploaded file / sync run per restaurant.
-- pos_sales          one row per (day, POS item) from that import. Re-importing
--                    a file replaces the restaurant's rows for the days it
--                    covers (done in the API, inside one transaction), so the
--                    same day is never counted twice.
-- Money is NUMERIC(12,2) shekels like the rest of the matching domain; qty is
-- NUMERIC(12,3) (portions can be fractional, e.g. 0.5 kg by weight).
-- Tenant isolation: rls/0002's allowlist is closed to wave-1 sessions, so this
-- migration enables RLS and creates the same per-restaurant policy itself. The
-- policy inlines the body of app.current_restaurant_id() (that function is
-- created by rls/0002, which runs AFTER migrations on a fresh database), so it
-- is identical in effect and needs nothing that doesn't exist yet. The app
-- role's blanket table grants (src/rls.ts) cover the new tables.
CREATE TABLE IF NOT EXISTS "pos_sales_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "filename" text NOT NULL,
  "period_from" date NOT NULL,
  "period_to" date NOT NULL,
  "row_count" integer NOT NULL DEFAULT 0,
  "total_net" numeric(12, 2) NOT NULL DEFAULT '0',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pos_sales_imports_period_check" CHECK ("period_from" <= "period_to")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sales_imports_restaurant_idx" ON "pos_sales_imports" ("restaurant_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pos_sales" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "import_id" uuid NOT NULL REFERENCES "pos_sales_imports"("id") ON DELETE CASCADE,
  "sold_on" date NOT NULL,
  "item_ref" varchar(64) NOT NULL,
  "item_name" text NOT NULL,
  "qty" numeric(12, 3) NOT NULL,
  "net_amount" numeric(12, 2) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "pos_sales_qty_check" CHECK ("qty" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pos_sales_day_item_idx" ON "pos_sales" ("restaurant_id", "sold_on", "item_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pos_sales_import_idx" ON "pos_sales" ("import_id");--> statement-breakpoint
ALTER TABLE "pos_sales_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "pos_sales_imports_tenant" ON "pos_sales_imports";--> statement-breakpoint
CREATE POLICY "pos_sales_imports_tenant" ON "pos_sales_imports"
  USING ("restaurant_id" = nullif(current_setting('app.current_restaurant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pos_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "pos_sales_tenant" ON "pos_sales";--> statement-breakpoint
CREATE POLICY "pos_sales_tenant" ON "pos_sales"
  USING ("restaurant_id" = nullif(current_setting('app.current_restaurant_id', true), '')::uuid);
