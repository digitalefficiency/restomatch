-- 0060_revoked_sessions (S4 auth/security)
--
-- Per-session sign-out. Every authenticated response re-issues the session
-- cookie (rolling JWT), so a request still in flight when the user signs out
-- can plant the still-valid JWT again. Each JWT carries a random `sid`;
-- sign-out records it here and the node jwt callback rejects any token whose
-- sid is listed. Rows past `expires_at` are dead (the JWT they name has
-- expired too) and are deleted on read.
--
-- Identity trust zone (no restaurant_id): written and read ONLY through the
-- privileged auth connection (apps/web/lib/authDb). The tenant app role gets
-- nothing — RLS on with NO policies (deny-all for every non-owner role, so a
-- later blanket GRANT still yields zero rows) plus an explicit REVOKE,
-- role-existence-guarded like 0026.
CREATE TABLE IF NOT EXISTS "revoked_sessions" (
  "sid" uuid PRIMARY KEY,
  "expires_at" timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_sessions_expires_at_idx" ON "revoked_sessions" ("expires_at");--> statement-breakpoint
ALTER TABLE "revoked_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'restomatch_app') THEN
    REVOKE ALL ON TABLE "revoked_sessions" FROM restomatch_app;
  END IF;
END $$;
