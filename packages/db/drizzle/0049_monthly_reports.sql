-- 0049_monthly_reports (S12, wave 1 — flag `monthlyReport`)
--
-- The monthly "one number" report, frozen when the worker generates it on the
-- 1st of the month (so the email, the WhatsApp text and the PDF the owner
-- downloads later all show the same figures even if invoices are edited after).
--
--   monthly_reports – one row per (restaurant, month). `month` = first day of the
--                     reported local month. `snapshot` = the computed report
--                     (integer agorot inside). `sent_at` = when the outbox rows
--                     were enqueued (NULL = generated but not sent yet).
--
-- Tenant table; RLS enabled + per-restaurant policy in this file. Additive only.
-- Hand-written (drizzle-kit generate is broken in this repo).
CREATE TABLE IF NOT EXISTS "monthly_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "month" date NOT NULL,
  "snapshot" jsonb NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "monthly_reports_month_first_day_check" CHECK (extract(day from "month") = 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_reports_restaurant_month_unique" ON "monthly_reports" ("restaurant_id", "month");--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "monthly_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "monthly_reports_tenant" ON "monthly_reports";--> statement-breakpoint
CREATE POLICY "monthly_reports_tenant" ON "monthly_reports" USING (restaurant_id = app.current_restaurant_id());
