-- 0073_schema_batch_b (wave 3, H-04): field and platform.
-- HUMAN-PR proposal, stacked on H-03's 0072 (which stacks on G-03's 0071). Every
-- change is additive (nullable or defaulted); no existing column changes meaning,
-- except that inventory_counts.status ALSO accepts 'submitted' (a widened CHECK).
-- No app code reads or writes these objects in this PR: every reader ships in its
-- own package after the deploy. NO BACKFILL: no existing row is read or updated.
-- Nothing here touches a leak / discrepancy ₪ figure: no engine input, no
-- LEAK_FILTER column.
-- Out of scope (owner decision 13, approval 7): device registration, a per-user PIN
-- hash, an idle lock and a sessions table. Each worker signs in with their own
-- e-mail and password. The outbox `role:` CHECK is NOT here: it is a separate file
-- (drizzle/pending/), journaled and deployed only after H-05.
--
-- Money units (AGENTS.md money facts): waste_entries.unit_cost and
-- po_lines.unit_price_revised are NUMERIC(12,4) SHEKELS ex-VAT (like
-- unit_price_expected / inventory_count_lines.unit_cost); waste_entries.value_agorot
-- is an integer AGOROT bigint snapshot (like inventory_count_lines.value_agorot).
--
-- saved_views            a server-side view of a table page (filters / sort / columns
--                        in `query` jsonb). scope 'personal' (one member's, user_id
--                        set) or 'restaurant' (the whole team's, user_id NULL); a
--                        restaurant view may be the default of one role
--                        (role_default; one default per page × role).
-- view_subscriptions     a member receives a view on a cadence: daily, weekly
--                        (weekday 0 = Sunday … 6) or monthly (day 1..28), at
--                        send_hour (0..23, restaurant local time; default 07:00),
--                        over a channel. H-05 delivers; this is storage only.
-- products (+count_sort) the shelf / walk order on a count (NULL = name order).
-- product_count_units    the units a product is counted in, each with how many of
--                        the line's count unit one of them holds (a case = 12).
-- inventory_count_lines (+qty_parts)
--                        how a counted qty was entered: [{"unit":"ארגז","qty":2},
--                        {"unit":"יח׳","qty":5}]. `qty` stays the TOTAL in `unit`;
--                        qty_parts is evidence only and never feeds a value.
-- inventory_counts (+'submitted', submitted_at, submitted_by)
--                        a chef finishes a count and hands it to a closer:
--                        draft → submitted → completed. One OPEN (draft or
--                        submitted) count per restaurant. The 0070 completion CHECK
--                        is unchanged (a submitted count has no values yet).
-- waste_entries          one thrown-away product or prepared recipe (exactly one of
--                        the two): qty + unit, reason, note, when, who, and the
--                        unit_cost / value_agorot snapshot at entry (NULL = no known
--                        price, shown calmly). Food-cost evidence, not a leak.
-- recipes (+method, plating, photo_key, allergens)
--                        the kitchen card. photo_key is a storage object key (never
--                        a URL); allergens are keys from a fixed list of 14.
-- suppliers (+billing_mode)
--                        'per_delivery' (a tax invoice with each delivery) or
--                        'consolidated' (delivery notes, one monthly invoice). NULL
--                        = unknown (the app's default chip). Not backfilled.
-- purchase_orders (+opened_at)
--                        the first time the supplier opened the order link.
-- po_lines (+qty_revised, unit_price_revised, revised_at, revised_by, revision_source)
--                        the accepted revised expectation (the supplier's change,
--                        or a manual one). qty_ordered / unit_price_expected stay
--                        the ORIGINAL for audit. revised_at is set exactly when a
--                        revised value is; the source then too.
-- notification_seen      a member has seen (and maybe dismissed) one bell item,
--                        named by a stable item_key (e.g. 'invoice:<id>:decide').
--
-- Tenant safety: the 0057/0070/0071/0072 pattern. Every new table carries
-- restaurant_id NOT NULL, UNIQUE (id, restaurant_id), SAME-TENANT composite FKs to
-- tenant tables, and RLS enabled HERE with the `<table>_tenant` policy that
-- drizzle/rls/0002 also creates (they are in its table list). FKs to users stay
-- single-column: users is global (no restaurant_id). No users.* column is added.
--
-- Batch safety: no ALTER TYPE, and no enum value from 0071 is used here.
--
-- Locks: the Supabase CLI applies a file as ONE pipelined batch with no BEGIN, so a
-- top-level LOCK TABLE / SET LOCAL / SAVEPOINT is refused there (25P01) and nothing
-- applies. The prelude therefore (1) sets lock_timeout 5s and a 6s statement_timeout
-- with set_config(..., is_local => true), keeping the previous statement_timeout in
-- restomatch.prev_statement_timeout; (2) takes every lock in ONE DO block,
-- parent-first (the 0071/0072 order): SHARE ROW EXCLUSIVE on "restaurants" and
-- "users" (FK targets only), ACCESS EXCLUSIVE on the seven existing tables this file
-- alters (products and recipes are also FK targets); (3) restores statement_timeout.
-- A long reader makes the file fail fast (55P03 / 57014) with nothing applied;
-- re-run it in a quiet hour.
-- Stacked drizzle path: `pnpm db:migrate` applies 0071 + 0072 + 0073 in ONE
-- transaction. 0073 asks for nothing stronger than what 0071/0072 already hold on
-- restaurants (0072: ACCESS EXCLUSIVE), users (0072: AE), suppliers (0072: AE),
-- purchase_orders (0071: AE) and po_lines (0072: AE); it takes NEW ACCESS EXCLUSIVE
-- locks on products, recipes, inventory_counts and inventory_count_lines mid-batch.
-- A busy table then fails the WHOLE batch fast (nothing applied). Re-run it.
--
-- App coupling: schema.ts names the new columns of EXISTING tables in every Drizzle
-- select/insert, so a build of main that carries this schema.ts fails against a DB
-- without 0073. Promote a build only after 0073 is confirmed applied (PR runbook).
--
-- Additive only, idempotent (IF NOT EXISTS / guarded DO blocks); a second run is a
-- no-op. Rollback = a reverse forward migration (the ordered procedure in the PR
-- body: app first, then this SQL, then the tracker rows, with the rls/0002 list
-- reverted in the same revert):
--   DROP TRIGGER saved_views_set_updated_at ON saved_views;  -- and the three other
--     *_set_updated_at triggers on view_subscriptions, product_count_units, waste_entries
--   DROP TABLE notification_seen, waste_entries, product_count_units,
--     view_subscriptions, saved_views;
--   UPDATE inventory_counts SET status = 'draft' WHERE status = 'submitted';  -- forward-revert
--   DROP INDEX inventory_counts_one_open_idx;
--   ALTER TABLE inventory_counts DROP CONSTRAINT inventory_counts_submitted_check,
--     DROP CONSTRAINT inventory_counts_status_check,
--     DROP COLUMN submitted_at, DROP COLUMN submitted_by,
--     ADD CONSTRAINT inventory_counts_status_check CHECK (status IN ('draft', 'completed'));
--   ALTER TABLE inventory_count_lines DROP COLUMN qty_parts;
--   ALTER TABLE products DROP COLUMN count_sort;
--   ALTER TABLE recipes DROP COLUMN method, DROP COLUMN plating, DROP COLUMN photo_key,
--     DROP COLUMN allergens;
--   ALTER TABLE suppliers DROP COLUMN billing_mode;
--   ALTER TABLE purchase_orders DROP COLUMN opened_at;
--   ALTER TABLE po_lines DROP CONSTRAINT po_lines_revised_pair_check, DROP COLUMN qty_revised,
--     DROP COLUMN unit_price_revised, DROP COLUMN revised_at, DROP COLUMN revised_by,
--     DROP COLUMN revision_source;
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1782600000000;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20260627224000', '20260627224001');

SELECT set_config('restomatch.prev_statement_timeout', current_setting('statement_timeout'), true),
       set_config('lock_timeout', '5s', true),
       set_config('statement_timeout', '6s', true);--> statement-breakpoint
DO $$
BEGIN
  LOCK TABLE "restaurants", "users" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "suppliers", "products", "purchase_orders", "po_lines", "recipes",
    "inventory_counts", "inventory_count_lines" IN ACCESS EXCLUSIVE MODE;
END $$;--> statement-breakpoint
-- Restore. If the saved value is gone (an applier that commits per statement already
-- reverted the local setting), keep the current one.
SELECT set_config('statement_timeout',
  coalesce(nullif(current_setting('restomatch.prev_statement_timeout', true), ''), current_setting('statement_timeout')),
  true);--> statement-breakpoint

-- ── saved_views + view_subscriptions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "page" varchar(64) NOT NULL,
  "name" varchar(80) NOT NULL,
  "query" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "scope" varchar(16) DEFAULT 'personal' NOT NULL,
  -- The member a personal view belongs to (it goes with them); NULL on a team view.
  "user_id" uuid REFERENCES "users"("id") ON DELETE cascade,
  "role_default" varchar(16),
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "saved_views_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "saved_views_page_nonempty_check" CHECK (btrim("page") <> ''),
  CONSTRAINT "saved_views_name_nonempty_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "saved_views_query_object_check" CHECK (jsonb_typeof("query") = 'object'),
  CONSTRAINT "saved_views_scope_check" CHECK ("scope" IN ('personal', 'restaurant')),
  CONSTRAINT "saved_views_scope_user_check" CHECK (("scope" = 'personal') = ("user_id" IS NOT NULL)),
  CONSTRAINT "saved_views_role_default_check" CHECK (
    "role_default" IS NULL
    OR ("scope" = 'restaurant' AND "role_default" IN ('owner', 'manager', 'receiver', 'bookkeeper', 'chef'))
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_restaurant_page_idx" ON "saved_views" USING btree ("restaurant_id", "page");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_user_idx" ON "saved_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_created_by_idx" ON "saved_views" USING btree ("created_by");--> statement-breakpoint
-- One default view per page × role in a restaurant.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_role_default_unique" ON "saved_views" USING btree ("restaurant_id", "page", "role_default") WHERE "role_default" IS NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS "saved_views_set_updated_at" ON "saved_views";--> statement-breakpoint
CREATE TRIGGER "saved_views_set_updated_at" BEFORE UPDATE ON "saved_views" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "view_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "view_id" uuid NOT NULL,
  -- The recipient is a member (H-05 resolves the address at send), never a free-text address.
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "cadence" varchar(16) NOT NULL,
  "send_hour" smallint DEFAULT 7 NOT NULL,
  "weekday" smallint,
  "month_day" smallint,
  "channel" varchar(16) DEFAULT 'email' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "last_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "view_subscriptions_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "view_subscriptions_view_user_channel_key" UNIQUE ("view_id", "user_id", "channel"),
  CONSTRAINT "view_subscriptions_view_same_tenant_fk" FOREIGN KEY ("view_id", "restaurant_id")
    REFERENCES "public"."saved_views"("id", "restaurant_id") ON DELETE cascade,
  CONSTRAINT "view_subscriptions_cadence_check" CHECK ("cadence" IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT "view_subscriptions_send_hour_check" CHECK ("send_hour" BETWEEN 0 AND 23),
  CONSTRAINT "view_subscriptions_weekday_check" CHECK (("cadence" = 'weekly') = ("weekday" IS NOT NULL) AND ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6)),
  CONSTRAINT "view_subscriptions_month_day_check" CHECK (("cadence" = 'monthly') = ("month_day" IS NOT NULL) AND ("month_day" IS NULL OR "month_day" BETWEEN 1 AND 28)),
  CONSTRAINT "view_subscriptions_channel_check" CHECK ("channel" IN ('email', 'whatsapp', 'push'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "view_subscriptions_view_idx" ON "view_subscriptions" USING btree ("view_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "view_subscriptions_user_idx" ON "view_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "view_subscriptions_restaurant_idx" ON "view_subscriptions" USING btree ("restaurant_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "view_subscriptions_set_updated_at" ON "view_subscriptions";--> statement-breakpoint
CREATE TRIGGER "view_subscriptions_set_updated_at" BEFORE UPDATE ON "view_subscriptions" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ── counting: walk order, count units, multi-unit entry, submitted ────────────
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "count_sort" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_count_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "product_id" uuid NOT NULL,
  "unit" varchar(32) NOT NULL,
  -- How many of the count line's unit one of this unit holds (a case of 12 = 12).
  "base_qty" numeric(12, 4) NOT NULL,
  "sort_order" smallint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_count_units_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "product_count_units_product_unit_key" UNIQUE ("product_id", "unit"),
  CONSTRAINT "product_count_units_product_same_tenant_fk" FOREIGN KEY ("product_id", "restaurant_id")
    REFERENCES "public"."products"("id", "restaurant_id") ON DELETE cascade,
  CONSTRAINT "product_count_units_unit_nonempty_check" CHECK (btrim("unit") <> ''),
  CONSTRAINT "product_count_units_base_qty_check" CHECK ("base_qty" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_count_units_product_idx" ON "product_count_units" USING btree ("product_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_count_units_restaurant_idx" ON "product_count_units" USING btree ("restaurant_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "product_count_units_set_updated_at" ON "product_count_units";--> statement-breakpoint
CREATE TRIGGER "product_count_units_set_updated_at" BEFORE UPDATE ON "product_count_units" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD COLUMN IF NOT EXISTS "qty_parts" jsonb
  CONSTRAINT "inventory_count_lines_qty_parts_array_check" CHECK (jsonb_typeof("qty_parts") = 'array');--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD COLUMN IF NOT EXISTS "submitted_by" uuid REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_counts_submitted_by_idx" ON "inventory_counts" USING btree ("submitted_by");--> statement-breakpoint
-- Widen 0070's status CHECK to draft | submitted | completed (every existing row is
-- draft or completed, so the re-validation under the lock above cannot fail).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_counts_status_check' AND pg_get_constraintdef(oid) LIKE '%submitted%'
  ) THEN
    ALTER TABLE "inventory_counts" DROP CONSTRAINT IF EXISTS "inventory_counts_status_check";
    ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_status_check"
      CHECK ("status" IN ('draft', 'submitted', 'completed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counts_submitted_check') THEN
    ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_submitted_check"
      CHECK ("status" <> 'submitted' OR "submitted_at" IS NOT NULL);
  END IF;
END $$;--> statement-breakpoint
-- One OPEN count per restaurant: a submitted count still blocks a second draft.
-- (0070's inventory_counts_one_draft_idx stays; it is implied by this one.)
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_counts_one_open_idx" ON "inventory_counts" USING btree ("restaurant_id") WHERE "status" IN ('draft', 'submitted');--> statement-breakpoint

-- ── waste_entries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "waste_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "product_id" uuid,
  "recipe_id" uuid,
  "qty" numeric(12, 4) NOT NULL,
  "unit" varchar(32) NOT NULL,
  "reason" varchar(24) NOT NULL,
  "note" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unit_cost" numeric(12, 4),
  "value_agorot" bigint,
  "recorded_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "waste_entries_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- Waste is food-cost evidence: the product / recipe cannot be deleted from under it
  -- (NO ACTION, checked at statement end, so a restaurant delete still cascades).
  CONSTRAINT "waste_entries_product_same_tenant_fk" FOREIGN KEY ("product_id", "restaurant_id")
    REFERENCES "public"."products"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "waste_entries_recipe_same_tenant_fk" FOREIGN KEY ("recipe_id", "restaurant_id")
    REFERENCES "public"."recipes"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "waste_entries_one_subject_check" CHECK (num_nonnulls("product_id", "recipe_id") = 1),
  CONSTRAINT "waste_entries_qty_check" CHECK ("qty" > 0),
  CONSTRAINT "waste_entries_unit_nonempty_check" CHECK (btrim("unit") <> ''),
  CONSTRAINT "waste_entries_reason_check" CHECK ("reason" IN ('spoiled', 'expired', 'prep_error', 'dropped', 'returned', 'overproduction', 'staff_meal', 'other')),
  CONSTRAINT "waste_entries_unit_cost_check" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0),
  CONSTRAINT "waste_entries_value_check" CHECK ("value_agorot" IS NULL OR "value_agorot" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waste_entries_product_idx" ON "waste_entries" USING btree ("product_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waste_entries_recipe_idx" ON "waste_entries" USING btree ("recipe_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waste_entries_restaurant_occurred_idx" ON "waste_entries" USING btree ("restaurant_id", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waste_entries_recorded_by_idx" ON "waste_entries" USING btree ("recorded_by");--> statement-breakpoint
DROP TRIGGER IF EXISTS "waste_entries_set_updated_at" ON "waste_entries";--> statement-breakpoint
CREATE TRIGGER "waste_entries_set_updated_at" BEFORE UPDATE ON "waste_entries" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ── recipes: the kitchen card ─────────────────────────────────────────────────
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "method" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "plating" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "photo_key" text
  CONSTRAINT "recipes_photo_key_check" CHECK (btrim("photo_key") <> '' AND "photo_key" NOT LIKE '%://%');--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "allergens" text[] DEFAULT '{}'::text[] NOT NULL
  CONSTRAINT "recipes_allergens_check" CHECK ("allergens" <@ ARRAY['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::text[]);--> statement-breakpoint

-- ── suppliers.billing_mode / purchase_orders.opened_at / po_lines revised ─────
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "billing_mode" varchar(16)
  CONSTRAINT "suppliers_billing_mode_check" CHECK ("billing_mode" IN ('per_delivery', 'consolidated'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "qty_revised" numeric(12, 3)
  CONSTRAINT "po_lines_qty_revised_nonneg_check" CHECK ("qty_revised" >= 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "unit_price_revised" numeric(12, 4)
  CONSTRAINT "po_lines_unit_price_revised_nonneg_check" CHECK ("unit_price_revised" >= 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "revised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "revised_by" uuid REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "revision_source" varchar(16)
  CONSTRAINT "po_lines_revision_source_check" CHECK ("revision_source" IN ('supplier_confirm', 'manual'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_lines_revised_by_idx" ON "po_lines" USING btree ("revised_by");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_lines_revised_pair_check') THEN
    ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_revised_pair_check" CHECK (
      ("revised_at" IS NOT NULL) = ("qty_revised" IS NOT NULL OR "unit_price_revised" IS NOT NULL)
      AND ("revised_at" IS NOT NULL) = ("revision_source" IS NOT NULL)
    );
  END IF;
END $$;--> statement-breakpoint

-- ── notification_seen ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_seen" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "item_key" varchar(160) NOT NULL,
  "seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "dismissed_at" timestamp with time zone,
  CONSTRAINT "notification_seen_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "notification_seen_user_item_key" UNIQUE ("restaurant_id", "user_id", "item_key"),
  CONSTRAINT "notification_seen_item_key_nonempty_check" CHECK (btrim("item_key") <> '')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_seen_user_idx" ON "notification_seen" USING btree ("user_id");--> statement-breakpoint

-- ── RLS on the five new tenant tables (also in rls/0002's list) ───────────────
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "saved_views_tenant" ON "saved_views";--> statement-breakpoint
CREATE POLICY "saved_views_tenant" ON "saved_views" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "view_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "view_subscriptions_tenant" ON "view_subscriptions";--> statement-breakpoint
CREATE POLICY "view_subscriptions_tenant" ON "view_subscriptions" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "product_count_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "product_count_units_tenant" ON "product_count_units";--> statement-breakpoint
CREATE POLICY "product_count_units_tenant" ON "product_count_units" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "waste_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "waste_entries_tenant" ON "waste_entries";--> statement-breakpoint
CREATE POLICY "waste_entries_tenant" ON "waste_entries" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "notification_seen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_seen_tenant" ON "notification_seen";--> statement-breakpoint
CREATE POLICY "notification_seen_tenant" ON "notification_seen" USING ("restaurant_id" = app.current_restaurant_id());
