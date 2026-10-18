-- TOTP one-time-use replay marker (Epic C, adversarial finding #4) — additive
-- column on user_credentials.
--
-- verifySecondFactor (lib/totp) accepts a TOTP within a ±1 time-step (~90s)
-- window. Without recording WHICH step was consumed, the same 6-digit code could
-- be replayed while still inside that window (RFC 6238 §5.2 requires rejecting a
-- second use after a successful validation). totp_last_step stores the last
-- successfully-consumed step (floor(epoch/30) + matched delta); the verifier
-- advances it atomically (WHERE totp_last_step < step) and rejects any code whose
-- step is <= the stored value. Recovery codes are already one-time and do not
-- touch this column.
--
-- ⚠ MERGE NOTE: stacks on 0019_user_credentials / 0020_two_factor_ticket (Epic
-- B/C). Like 0019/0020 these indices COLLIDE with the parallel security stack and
-- must be renumbered to the next free index on merge, updating _journal.json.
-- Purely additive (ADD COLUMN), safe online (brief ACCESS EXCLUSIVE), and a
-- no-op-safe re-run via IF NOT EXISTS.
ALTER TABLE "user_credentials"
  ADD COLUMN IF NOT EXISTS "totp_last_step" integer;
