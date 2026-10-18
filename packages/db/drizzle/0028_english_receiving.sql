-- 0028 — "Receiver in English": Hebrew invoices readable by non-Hebrew-speaking staff.
--
-- A receiver who doesn't read Hebrew (often a foreign worker) must still be able
-- to check a Hebrew invoice against the delivery. We store English renderings
-- next to the Hebrew source of truth — never replacing it, so matching, exports
-- and the leak math keep running on the original text:
--
--   products.name_en                – English display name of the restaurant's product
--   suppliers.name_en               – optional Latin-script supplier name
--   invoice_lines.raw_description_en – English rendering of the OCR'd invoice line
--   po_lines.raw_description_en      – English rendering of an imported PO line
--   memberships.preferred_locale     – a member's UI language ('he' | 'en'), set by a
--                                      manager on the Team page; NULL = device choice
--
-- All columns are nullable and additive: no backfill, no rewrite, no lock beyond
-- the brief ACCESS EXCLUSIVE of ADD COLUMN (metadata-only on PG ≥ 11). RLS is
-- row-based and the app role's grants are table-level, so nothing else changes.
--
-- Hand-written (drizzle-kit generate is broken in this repo).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "name_en" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "name_en" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "raw_description_en" text;--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "raw_description_en" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "preferred_locale" varchar(8);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_preferred_locale_check') THEN
    ALTER TABLE "memberships"
      ADD CONSTRAINT "memberships_preferred_locale_check"
      CHECK ("preferred_locale" IS NULL OR "preferred_locale" IN ('he', 'en'));
  END IF;
END $$;
