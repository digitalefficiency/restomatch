-- Exclusivity FOUNDATION (Wave 4): give products an owning supplier.
--
-- ADD COLUMN nullable + FK + index ONLY. The NOT-NULL flip is DEFERRED
-- post-pilot — do NOT add SET NOT NULL here. Legacy products have no owner yet;
-- the dry-run backfill (packages/db/scripts/backfill-product-supplier.ts) assigns
-- owners (or reports needs_owner) before any future tightening.
--
-- supplier_id FK is ON DELETE RESTRICT (mirrors purchase_orders.supplier_id): a
-- supplier that owns products cannot be hard-deleted — forces soft-deactivate +
-- re-point. The FK alone does NOT enforce same-tenant; commitCatalogRows asserts
-- supplier.restaurant_id === product.restaurant_id at write time.
--
-- product_group_id is an INERT RESERVE: no FK, no code references it this wave.
-- Authored now so the later product-group migration is purely additive.
--
-- Additive + nullable: safe online, no backfill in this migration, no lock
-- contention beyond the brief ACCESS EXCLUSIVE for the column/FK add.
ALTER TABLE "products" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "product_group_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_restaurant_supplier_idx" ON "products" USING btree ("restaurant_id","supplier_id");
