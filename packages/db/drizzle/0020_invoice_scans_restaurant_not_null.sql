-- A.7 — eliminate the unscoped (NULL-tenant) invoice-scan class.
--
-- GUARDED backfill: refuses to tighten while any invoice_scans row lacks a
-- restaurant_id. Production MUST backfill the existing (~7) objects into their
-- owning tenant first — see docs/PR1-storage-isolation-APPLY.md for the exact
-- backfill + verification queries. On a clean DB (the test harness) the guard is
-- a no-op and the column flips to NOT NULL.
--
-- We deliberately do NOT auto-backfill here: the live invoice_scans.invoice_id
-- column holds opaque text ids ('walk-...'/'scan-...') that do not join the
-- invoices uuid PK, so there is no safe automatic tenant inference. The human
-- backfills explicitly per the runbook, then applies this migration.
--
-- Hand-written (drizzle-kit generate is broken in this repo).
DO $$
DECLARE unscoped bigint;
BEGIN
  SELECT count(*) INTO unscoped FROM invoice_scans WHERE restaurant_id IS NULL;
  IF unscoped > 0 THEN
    RAISE EXCEPTION 'invoice_scans: % row(s) have NULL restaurant_id — backfill before NOT NULL (see docs/PR1-storage-isolation-APPLY.md)', unscoped;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "invoice_scans" ALTER COLUMN "restaurant_id" SET NOT NULL;
