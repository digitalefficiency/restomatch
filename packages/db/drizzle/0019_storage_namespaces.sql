-- A.4 — per-restaurant storage namespace registry.
--
-- onboarding.createRestaurant records each tenant's bucket prefix
-- ('<restaurantId>/') in the SAME transaction that creates the restaurant, so
-- every tenant gets an explicit, quota-trackable, isolated storage namespace at
-- creation time. The prefix-scoped storage.objects RLS
-- (drizzle/rls/0001_invoice_scans_rls.sql) enforces isolation on that namespace.
--
-- Hand-written (drizzle-kit generate is broken in this repo). Additive + has a
-- restaurant_id column, so its per-tenant RLS policy is added to the
-- 0002_core_tenant_rls.sql tenant-table loop (and re-applied by applyCoreTenantRls
-- in the test harness). Production: re-apply 0002 (idempotent) OR the standalone
-- policy snippet in docs/PR1-storage-isolation-APPLY.md.
CREATE TABLE IF NOT EXISTS "storage_namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"bucket" text DEFAULT 'invoice-scans' NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "storage_namespaces" ADD CONSTRAINT "storage_namespaces_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "storage_namespaces_restaurant_bucket_idx" ON "storage_namespaces" USING btree ("restaurant_id","bucket");
