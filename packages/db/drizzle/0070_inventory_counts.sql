-- 0070_inventory_counts (S17 — inventory counting → actual food cost, flag `inventoryCount`)
--
-- inventory_counts       one stock count (ספירת מלאי) on a local date. A count is a
--                        DRAFT while the chef walks the storage areas (autosaved,
--                        resumable) and COMPLETED once finished: at completion every
--                        line's unit cost and ₪ value are snapshotted, plus the
--                        count's total, so a closed count never drifts when prices
--                        move later. food_sales_ex_vat is the manual food-sales
--                        figure for the period ENDING at this count (used when no
--                        POS sales exist). One open draft per restaurant.
-- inventory_count_lines  one product on a count: where it is (storage_area key),
--                        how much (qty in `unit`, NULL = not counted yet), and the
--                        completion snapshot: unit_cost (ex-VAT ₪ per `unit`, NULL =
--                        no known price → excluded from the value, shown calmly)
--                        and value_agorot (integer agorot, half-up), plus price_source: where
--                        that price came from (invoice number + date, supplier, observed
--                        at) so the owner recognises it — also frozen at completion.
--
-- Tenant safety: the 0057 pattern. Both tables carry restaurant_id; every
-- reference is a SAME-TENANT composite FK; RLS is enabled HERE with the same
-- `<table>_tenant` policy drizzle/rls/0002 creates (the app.* GUC reader is the
-- byte-identical CREATE OR REPLACE). Products on a count cannot be deleted
-- (RESTRICT); deleting a count deletes its lines (CASCADE).
--
-- Additive only, idempotent. Rollback: DROP TABLE inventory_count_lines; DROP TABLE inventory_counts;
CREATE TABLE IF NOT EXISTS "inventory_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "count_date" date NOT NULL,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "counted_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "food_sales_ex_vat" numeric(12, 2),
  "total_value_agorot" bigint,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_counts_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "inventory_counts_status_check" CHECK ("status" IN ('draft', 'completed')),
  CONSTRAINT "inventory_counts_completed_check" CHECK (
    ("status" = 'completed') = ("completed_at" IS NOT NULL)
    AND ("status" = 'completed') = ("total_value_agorot" IS NOT NULL)
  ),
  CONSTRAINT "inventory_counts_total_check" CHECK ("total_value_agorot" IS NULL OR "total_value_agorot" >= 0),
  CONSTRAINT "inventory_counts_sales_check" CHECK ("food_sales_ex_vat" IS NULL OR "food_sales_ex_vat" >= 0)
);--> statement-breakpoint
-- One open draft per restaurant at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_counts_one_draft_idx" ON "inventory_counts" USING btree ("restaurant_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_counts_restaurant_date_idx" ON "inventory_counts" USING btree ("restaurant_id", "count_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_counts_counted_by_idx" ON "inventory_counts" USING btree ("counted_by");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_count_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "count_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "storage_area" varchar(16) DEFAULT 'dry' NOT NULL,
  "qty" numeric(12, 4),
  "unit" varchar(32) NOT NULL,
  "unit_cost" numeric(12, 4),
  "value_agorot" bigint,
  "price_source" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_count_lines_count_same_tenant_fk" FOREIGN KEY ("count_id", "restaurant_id")
    REFERENCES "public"."inventory_counts"("id", "restaurant_id") ON DELETE cascade,
  CONSTRAINT "inventory_count_lines_product_same_tenant_fk" FOREIGN KEY ("product_id", "restaurant_id")
    REFERENCES "public"."products"("id", "restaurant_id") ON DELETE restrict,
  CONSTRAINT "inventory_count_lines_area_check" CHECK ("storage_area" IN ('fridge', 'freezer', 'dry', 'produce', 'bar', 'other')),
  CONSTRAINT "inventory_count_lines_qty_check" CHECK ("qty" IS NULL OR "qty" >= 0),
  CONSTRAINT "inventory_count_lines_unit_nonempty_check" CHECK (btrim("unit") <> ''),
  CONSTRAINT "inventory_count_lines_unit_cost_check" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0),
  CONSTRAINT "inventory_count_lines_value_check" CHECK ("value_agorot" IS NULL OR "value_agorot" >= 0)
);--> statement-breakpoint
-- One line per product per count; also serves the (count_id, …) FK lookups.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_count_product_idx" ON "inventory_count_lines" USING btree ("count_id", "product_id");--> statement-breakpoint
-- Each composite FK gets a matching index (db:doctor "foreign keys indexed").
CREATE INDEX IF NOT EXISTS "inventory_count_lines_count_idx" ON "inventory_count_lines" USING btree ("count_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_count_lines_product_idx" ON "inventory_count_lines" USING btree ("product_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_count_lines_restaurant_idx" ON "inventory_count_lines" USING btree ("restaurant_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "inventory_counts_set_updated_at" ON "inventory_counts";--> statement-breakpoint
CREATE TRIGGER "inventory_counts_set_updated_at" BEFORE UPDATE ON "inventory_counts" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
DROP TRIGGER IF EXISTS "inventory_count_lines_set_updated_at" ON "inventory_count_lines";--> statement-breakpoint
CREATE TRIGGER "inventory_count_lines_set_updated_at" BEFORE UPDATE ON "inventory_count_lines" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "inventory_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "inventory_counts_tenant" ON "inventory_counts";--> statement-breakpoint
CREATE POLICY "inventory_counts_tenant" ON "inventory_counts" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "inventory_count_lines_tenant" ON "inventory_count_lines";--> statement-breakpoint
CREATE POLICY "inventory_count_lines_tenant" ON "inventory_count_lines" USING ("restaurant_id" = app.current_restaurant_id());
