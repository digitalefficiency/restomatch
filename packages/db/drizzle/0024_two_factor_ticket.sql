-- 2FA second-factor "pass ticket" (Epic C) — additive columns on user_credentials.
--
-- After /login/2fa verifies a TOTP / recovery code SERVER-SIDE, it mints a random
-- nonce, stores ONLY sha256(nonce) in two_factor_ticket_hash with a short expiry,
-- and hands the raw nonce to the Auth.js session update. The jwt callback
-- re-validates the nonce against this hash (unexpired, one-time) before clearing
-- twoFactorPending — so a direct POST to the session-update endpoint cannot bypass
-- the second factor (the client never sees the hash and cannot forge the nonce).
--
-- ⚠ MERGE NOTE: stacks on 0019_user_credentials (Epic B). Like 0019 this index
-- (0020) collides with the parallel security stack and must be renumbered to the
-- next free index on merge, updating _journal.json. Purely additive (ADD COLUMN),
-- safe online (brief ACCESS EXCLUSIVE), and a no-op-safe re-run via IF NOT EXISTS.
ALTER TABLE "user_credentials"
  ADD COLUMN IF NOT EXISTS "two_factor_ticket_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "user_credentials"
  ADD COLUMN IF NOT EXISTS "two_factor_ticket_expires" timestamp with time zone;
