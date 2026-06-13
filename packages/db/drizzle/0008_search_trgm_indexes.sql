-- Phase 5 search: pg_trgm GIN indexes for fuzzy similarity() / ILIKE lookups.
-- pg_trgm is already enabled by the migrate runner (CREATE EXTENSION pg_trgm).
CREATE INDEX IF NOT EXISTS "products_canonical_name_trgm_idx" ON "products" USING gin ("canonical_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_name_trgm_idx" ON "suppliers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_trgm_idx" ON "invoices" USING gin ("invoice_number" gin_trgm_ops);
