-- 0029 — I5: platform-reference uniques are per RESTAURANT, not global.
--
-- po_source_ref_unique (source_platform, source_ref) and
-- suppliers_external_ref_unique (source_platform, external_ref) were GLOBAL. A
-- platform order id / supplier id is only unique inside ONE platform account, so
-- the second restaurant that imports or syncs the same MarketMan/Zestt reference
-- hit a 23505 on insert (or, before the restaurant filter was added to the
-- lookups, overwrote the first tenant's PO). The app code already looks rows up
-- by (restaurant_id, platform, ref) — importPo.ts and syncPlatforms.ts — so only
-- the DB backstop was wrong. Neither index is an ON CONFLICT target anywhere.
--
-- PRECONDITION: none can fail. The new keys are strictly LOOSER than the old
-- ones (old unique on (a,b) ⇒ (restaurant_id,a,b) is unique too), so creating
-- them on any data that satisfied the old index always succeeds. NULLs stay
-- distinct (manual POs / manual suppliers have NULL refs and are unconstrained).
--
-- Order: create the new index BEFORE dropping the old one so there is never a
-- moment without a backstop. The whole pending batch runs in one transaction
-- (drizzle migrator), so this is atomic anyway.
--
-- Rollback (only if no two tenants share a ref yet):
--   CREATE UNIQUE INDEX po_source_ref_unique ON purchase_orders (source_platform, source_ref);
--   CREATE UNIQUE INDEX suppliers_external_ref_unique ON suppliers (source_platform, external_ref);
--   DROP INDEX po_restaurant_source_ref_unique, suppliers_restaurant_external_ref_unique;
--
-- Hand-written (drizzle-kit generate is broken in this repo).
CREATE UNIQUE INDEX IF NOT EXISTS "po_restaurant_source_ref_unique" ON "purchase_orders" USING btree ("restaurant_id","source_platform","source_ref");--> statement-breakpoint
DROP INDEX IF EXISTS "po_source_ref_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_restaurant_external_ref_unique" ON "suppliers" USING btree ("restaurant_id","source_platform","external_ref");--> statement-breakpoint
DROP INDEX IF EXISTS "suppliers_external_ref_unique";
