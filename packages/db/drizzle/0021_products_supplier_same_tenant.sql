-- Epic 0.5 — enforce same-tenant for products.supplier_id at the DATABASE level.
--
-- The wave-4 FK products.supplier_id → suppliers(id) does NOT prevent a product
-- from referencing a supplier in ANOTHER restaurant (R-40). commitCatalogRows
-- asserts supplier.restaurant_id === product.restaurant_id at write time, but
-- that is app-layer only. This migration makes it a referential invariant:
--
--   (supplier_id, restaurant_id) → suppliers(id, restaurant_id)
--
-- A composite FK with the default MATCH SIMPLE skips the check when supplier_id
-- IS NULL (legacy products with no owner stay valid), and otherwise REQUIRES the
-- referenced supplier to live in the SAME restaurant. FK checks run with RLS
-- bypassed, so this holds for the owner/worker/service paths too — not just the
-- RLS-scoped tenant role.
--
-- ON DELETE RESTRICT is preserved (mirrors the original FK + purchase_orders):
-- a supplier owning products cannot be hard-deleted; soft-deactivate + re-point.
--
-- PRECONDITION: no cross-tenant offenders may exist or the FK validation fails
-- loudly (intended). Repair first:
--   select p.id from products p join suppliers s on s.id = p.supplier_id
--   where p.supplier_id is not null and s.restaurant_id <> p.restaurant_id;
-- (Not applied to production in this PR — see docs/RLS-PROVISIONING-RUNBOOK.md.)

-- Composite FK needs a matching unique key on the referenced columns. id is
-- already the PK (unique), so (id, restaurant_id) is trivially unique; this
-- constraint just exposes it as a valid FK target.
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_id_restaurant_id_key" UNIQUE ("id","restaurant_id");--> statement-breakpoint

-- Replace the tenant-blind single-column FK with the same-tenant composite FK.
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_supplier_id_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id","restaurant_id") REFERENCES "public"."suppliers"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;
