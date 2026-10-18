-- Epic E — Legal / Privacy (Israel + Amendment 13).
--
-- Two additive, online-safe changes — NO data backfill, NO NOT-NULL flips on
-- existing rows, NO touch of tenant RLS (neither new table carries a
-- restaurant_id, so the 0002 completeness invariant does not apply to them):
--
--   1. leads marketing-consent columns (E.7 — Israeli anti-spam, Communications
--      Law §30A). Default marketing_consent=false so legacy leads are treated as
--      NOT consented until re-captured. unsubscribe_token lets a future
--      marketing send carry a one-click opt-out link.
--   2. dsr_requests — an append-only audit trail for data-subject-rights actions
--      (E.6: access/export/delete/erase). Not tenant-scoped: a DSR subject can be
--      a platform user (across restaurants) or a marketing lead, so it lives
--      outside the per-restaurant RLS model and is reached only via the
--      owner/admin connection (mirrors leads/users).
--
-- IF NOT EXISTS guards keep this idempotent for the manual Supabase cutover and
-- for direct application to the local test DB.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "consent_text" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "consent_source_ip" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "unsubscribe_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "unsubscribed_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dsr_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid,
  "subject_email" text,
  "action" text NOT NULL,
  "requested_by_user_id" uuid,
  "status" text DEFAULT 'completed' NOT NULL,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dsr_requests_subject_type_check" CHECK ("subject_type" IN ('user', 'lead')),
  CONSTRAINT "dsr_requests_action_check" CHECK ("action" IN ('export', 'delete', 'erase'))
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "dsr_requests" ADD CONSTRAINT "dsr_requests_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "dsr_requests_subject_idx" ON "dsr_requests" USING btree ("subject_type", "subject_id", "created_at");
