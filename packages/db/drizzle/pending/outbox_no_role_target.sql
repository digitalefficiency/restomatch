-- PENDING (wave 3, H-04 part 2): notifications_outbox refuses a symbolic `role:` target.
-- ┌────────────────────────────────────────────────────────────────────────────────┐
-- │ NOT IN THE JOURNAL. NOT MERGED ON 22.12. DEPLOY ONLY ON TUE 19.1, AFTER H-05.    │
-- │ Today matchInvoice / reports still enqueue `role:owner`-style rows; with this    │
-- │ CHECK applied they would fail. H-05 resolves every role to concrete members at   │
-- │ enqueue. Only after H-05 is deployed AND this read-only count is 0 for a week:   │
-- │   SELECT count(*) FROM notifications_outbox                                      │
-- │   WHERE target LIKE 'role:%' AND created_at > now() - interval '7 days';         │
-- │ does a human move this file to drizzle/00NN_outbox_no_role_target.sql (the next  │
-- │ free number), add its journal entry and run supabase-sync, in its own schema PR. │
-- └────────────────────────────────────────────────────────────────────────────────┘
-- NOT VALID: existing (historic) role: rows are not re-checked, only new and updated
-- rows. A later VALIDATE CONSTRAINT is optional, after the old rows are gone.
-- Pipeline-safe like 0071-0073: no top-level LOCK / SET LOCAL; one DO-block lock.
-- Idempotent. Rollback: ALTER TABLE notifications_outbox DROP CONSTRAINT
--   notifications_outbox_no_role_target_check;  then delete its tracker rows.

SELECT set_config('restomatch.prev_statement_timeout', current_setting('statement_timeout'), true),
       set_config('lock_timeout', '5s', true),
       set_config('statement_timeout', '6s', true);--> statement-breakpoint
DO $$
BEGIN
  LOCK TABLE "notifications_outbox" IN ACCESS EXCLUSIVE MODE;
END $$;--> statement-breakpoint
SELECT set_config('statement_timeout',
  coalesce(nullif(current_setting('restomatch.prev_statement_timeout', true), ''), current_setting('statement_timeout')),
  true);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_outbox_no_role_target_check') THEN
    ALTER TABLE "notifications_outbox" ADD CONSTRAINT "notifications_outbox_no_role_target_check"
      CHECK ("target" NOT LIKE 'role:%') NOT VALID;
  END IF;
END $$;
