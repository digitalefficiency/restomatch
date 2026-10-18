-- Self-contained REVOKE on the identity tables (adversarial finding #6).
--
-- 0019 CREATEs user_credentials / password_reset_tokens / user_recovery_codes but
-- carries no REVOKE — the canonical REVOKE ALL FROM restomatch_app lives only in
-- drizzle/rls/0002_core_tenant_rls.sql + packages/db/src/rls.ts (ensureRlsAppRole).
-- If production has an `ALTER DEFAULT PRIVILEGES ... GRANT ... TO restomatch_app`
-- (the test harness does), then between 0019 creating the tables and the re-apply
-- of rls/0002 the tenant app role would transiently hold full DML on them — a
-- compromised tenant path could mint a reset token, overwrite another user's
-- password_hash, or bump token_version (account takeover).
--
-- This migration runs in the SAME automated migrate pass, immediately after the
-- tables exist, so the window is closed regardless of whether the manual rls/0002
-- re-apply is performed. The REVOKE is role-existence-guarded (a no-op on a DB
-- that has no restomatch_app role yet — e.g. a fresh dev/CI DB where the role is
-- created later by ensureRlsAppRole, which itself re-REVOKEs). Idempotent.
--
-- ⚠ MERGE NOTE: stacks on 0019/0020/0021 (Epic B/C). Renumber to the next free
-- index on merge and update _journal.json, alongside the rest of the stack.
-- CUTOVER: still re-apply rls/0002 AFTER 0019–0022 and verify with
-- `\dp user_credentials` that restomatch_app has no privileges.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'restomatch_app') THEN
    EXECUTE 'REVOKE ALL ON user_credentials FROM restomatch_app';
    EXECUTE 'REVOKE ALL ON password_reset_tokens FROM restomatch_app';
    EXECUTE 'REVOKE ALL ON user_recovery_codes FROM restomatch_app';
  END IF;
END $$;
