-- 0048_recovery (S12, wave 1 — flag `recovery`)
--
-- The "₪ back" tracker: every claimed discrepancy follows a lifecycle until the
-- money is actually returned by the supplier.
--
--   recovery_claims  – one row per claimed discrepancy (unique discrepancy_id).
--                      status: claimed → letter_sent → acknowledged → credited
--                      → recovered; side states disputed / written_off.
--                      amount_agorot = the claimed amount (integer agorot, capped
--                      at the invoice's leak like the claim letter);
--                      credited_agorot = what the supplier credited against it.
--   credit_notes     – a supplier credit note (number, date, amount in agorot),
--                      entered manually or matched to the credit (negative) line
--                      of a later invoice (invoice_line_id).
--   recovery_events  – append-only lifecycle history (who moved what, when).
--
-- Money is INTEGER AGOROT (bigint, CHECK ≥ 0) — parse-at-boundary, never floats.
-- All three tables carry restaurant_id and are listed in rls/0002 (tenant RLS).
-- Cross-tenant references are refused in code (tenant guards in packages/api/src/recovery)
-- and by RLS: a tenant can only read/insert rows of its own restaurant.
-- Additive only: new tables, no change to existing rows.
-- Hand-written (drizzle-kit generate is broken in this repo).
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE CASCADE,
  "number" varchar(64),
  "amount_agorot" bigint NOT NULL,
  "issued_on" date NOT NULL,
  "source" varchar(16) NOT NULL DEFAULT 'manual',
  "invoice_line_id" uuid REFERENCES "invoice_lines"("id") ON DELETE SET NULL,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "note" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_notes_amount_check" CHECK ("amount_agorot" > 0),
  CONSTRAINT "credit_notes_source_check" CHECK ("source" IN ('manual', 'invoice_line'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_restaurant_idx" ON "credit_notes" ("restaurant_id", "issued_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_supplier_idx" ON "credit_notes" ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx" ON "credit_notes" ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_created_by_idx" ON "credit_notes" ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_invoice_line_unique" ON "credit_notes" ("invoice_line_id") WHERE "invoice_line_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "discrepancy_id" uuid NOT NULL REFERENCES "discrepancies"("id") ON DELETE CASCADE,
  "supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
  "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  "status" varchar(16) NOT NULL DEFAULT 'claimed',
  "amount_agorot" bigint NOT NULL,
  "credited_agorot" bigint NOT NULL DEFAULT 0,
  "credit_note_id" uuid REFERENCES "credit_notes"("id") ON DELETE SET NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "letter_sent_at" timestamp with time zone,
  "acknowledged_at" timestamp with time zone,
  "credited_at" timestamp with time zone,
  "recovered_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "last_reminder_at" timestamp with time zone,
  "note" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recovery_claims_status_check" CHECK ("status" IN
    ('claimed', 'letter_sent', 'acknowledged', 'credited', 'recovered', 'disputed', 'written_off')),
  CONSTRAINT "recovery_claims_amount_check" CHECK ("amount_agorot" >= 0),
  CONSTRAINT "recovery_claims_credited_check" CHECK ("credited_agorot" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_claims_discrepancy_unique" ON "recovery_claims" ("discrepancy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_restaurant_status_idx" ON "recovery_claims" ("restaurant_id", "status", "claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_supplier_idx" ON "recovery_claims" ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_credit_note_idx" ON "recovery_claims" ("credit_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_invoice_idx" ON "recovery_claims" ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_created_by_idx" ON "recovery_claims" ("created_by");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "claim_id" uuid NOT NULL REFERENCES "recovery_claims"("id") ON DELETE CASCADE,
  "from_status" varchar(16),
  "to_status" varchar(16) NOT NULL,
  "amount_agorot" bigint,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_claim_idx" ON "recovery_events" ("claim_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_restaurant_idx" ON "recovery_events" ("restaurant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_actor_idx" ON "recovery_events" ("actor_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "recovery_claims_set_updated_at" ON "recovery_claims";--> statement-breakpoint
CREATE TRIGGER "recovery_claims_set_updated_at" BEFORE UPDATE ON "recovery_claims"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
