-- Phase 0 SKU bridge: give the supplier catalog number (מק״ט) a home on both
-- sides of the match so lines can pair on a stable per-supplier key, not just
-- a fuzzy Hebrew name. Read path lands in @restomatch/catalog matchBySku.
-- Additive + nullable: safe online, no backfill, no lock contention.
ALTER TABLE "po_lines" ADD COLUMN "supplier_sku" varchar(64);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "supplier_sku" varchar(64);
