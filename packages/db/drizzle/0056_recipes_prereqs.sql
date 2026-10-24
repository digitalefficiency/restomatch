-- 0056_recipes_prereqs (S17 wave 1 — food cost per dish, flag `recipes`)
--
-- Additive prerequisites for the recipe tables in 0057:
--   1. products (id, restaurant_id) exposed as a UNIQUE key so recipe_items can
--      reference products with a SAME-TENANT composite FK (the 0021 pattern for
--      suppliers). id is the PK, so the pair is trivially unique — no data check.
--   2. an index serving "latest paid unit price per product" (DISTINCT ON
--      product_id ORDER BY observed_at DESC within a restaurant), which the
--      recipe cost engine runs on every recipes screen.
--
-- No data rewrite. Idempotent. Rollback:
--   ALTER TABLE products DROP CONSTRAINT products_id_restaurant_id_key;
--   DROP INDEX price_history_restaurant_product_observed_idx;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_id_restaurant_id_key') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_id_restaurant_id_key" UNIQUE ("id", "restaurant_id");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_restaurant_product_observed_idx"
  ON "price_history" USING btree ("restaurant_id", "product_id", "observed_at");
