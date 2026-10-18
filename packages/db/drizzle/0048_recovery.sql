-- 0048_recovery (S12, wave 1 — flag `recovery`)
--
-- The "₪ back" tracker: every claimed discrepancy follows a lifecycle until the
-- money is actually returned by the supplier.
--
--   recovery_claims  – one row per claimed discrepancy (unique discrepancy_id).
--                      status: claimed → letter_sent → acknowledged → credited
--                      → recovered; side states disputed / written_off.
--                      amount_agorot = the claimed amount (integer agorot, capped
--                      at the invoice total like the claim letter);
--                      credited_agorot = what the supplier credited against it.
--   credit_notes     – a supplier credit note (number, date, amount in agorot),
--                      entered manually or matched to the credit (negative) line
--                      of a later invoice (invoice_id + invoice_line_id).
--   recovery_events  – append-only lifecycle history (who moved what, when).
--
-- Money is INTEGER AGOROT (bigint, sign-checked) — parse-at-boundary, never floats.
--
-- SAME-TENANT by construction (RLS-independent): every reference to a tenant row
-- is a COMPOSITE FK (x_id, restaurant_id) → x(id, restaurant_id), so a row can
-- never point at another restaurant's supplier / invoice / discrepancy / note /
-- claim, and another tenant's deletes can never cascade into this tenant's rows.
-- An invoice line has no restaurant_id: credit_notes reaches it through its
-- invoice — (invoice_line_id, invoice_id) → invoice_lines(id, invoice_id) MATCH
-- FULL, with (invoice_id, restaurant_id) → invoices. A credit note derived from
-- an invoice's credit line is removed with that invoice (CASCADE; SET NULL would
-- break MATCH FULL mid-cascade); manual notes (both NULL) are unaffected.
-- Optional references use ON DELETE SET NULL (column) so restaurant_id stays.
--
-- RLS: enabled + per-restaurant policy at the end of this file (not in
-- drizzle/rls/0002), so the tables are protected from the moment they exist.
-- Additive only: three new tables + three supporting UNIQUE keys on existing
-- tables (index builds; no data change). Rollback = DROP TABLE … + DROP CONSTRAINT.
-- Hand-written (drizzle-kit generate is broken in this repo).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_id_restaurant_id_key') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_id_restaurant_id_key" UNIQUE ("id","restaurant_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discrepancies_id_restaurant_id_key') THEN
    ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_id_restaurant_id_key" UNIQUE ("id","restaurant_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_id_invoice_id_key') THEN
    ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_id_invoice_id_key" UNIQUE ("id","invoice_id");
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "supplier_id" uuid NOT NULL,
  "number" varchar(64),
  "amount_agorot" bigint NOT NULL,
  "issued_on" date NOT NULL,
  "source" varchar(16) NOT NULL DEFAULT 'manual',
  "invoice_line_id" uuid,
  "invoice_id" uuid,
  "note" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_notes_id_restaurant_id_key" UNIQUE ("id","restaurant_id"),
  CONSTRAINT "credit_notes_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id","restaurant_id")
    REFERENCES "suppliers"("id","restaurant_id") ON DELETE CASCADE,
  CONSTRAINT "credit_notes_invoice_same_tenant_fk" FOREIGN KEY ("invoice_id","restaurant_id")
    REFERENCES "invoices"("id","restaurant_id") ON DELETE CASCADE,
  CONSTRAINT "credit_notes_invoice_line_fk" FOREIGN KEY ("invoice_line_id","invoice_id")
    REFERENCES "invoice_lines"("id","invoice_id") MATCH FULL ON DELETE CASCADE,
  CONSTRAINT "credit_notes_amount_check" CHECK ("amount_agorot" > 0),
  CONSTRAINT "credit_notes_source_check" CHECK ("source" IN ('manual', 'invoice_line'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_restaurant_idx" ON "credit_notes" ("restaurant_id", "issued_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_supplier_idx" ON "credit_notes" ("supplier_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx" ON "credit_notes" ("invoice_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_created_by_idx" ON "credit_notes" ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_invoice_line_unique" ON "credit_notes" ("invoice_line_id", "invoice_id") WHERE "invoice_line_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "discrepancy_id" uuid NOT NULL,
  "supplier_id" uuid,
  "invoice_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'claimed',
  "amount_agorot" bigint NOT NULL,
  "credited_agorot" bigint NOT NULL DEFAULT 0,
  "credit_note_id" uuid,
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
  CONSTRAINT "recovery_claims_id_restaurant_id_key" UNIQUE ("id","restaurant_id"),
  CONSTRAINT "recovery_claims_discrepancy_same_tenant_fk" FOREIGN KEY ("discrepancy_id","restaurant_id")
    REFERENCES "discrepancies"("id","restaurant_id") ON DELETE CASCADE,
  CONSTRAINT "recovery_claims_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id","restaurant_id")
    REFERENCES "suppliers"("id","restaurant_id") ON DELETE SET NULL ("supplier_id"),
  CONSTRAINT "recovery_claims_invoice_same_tenant_fk" FOREIGN KEY ("invoice_id","restaurant_id")
    REFERENCES "invoices"("id","restaurant_id") ON DELETE SET NULL ("invoice_id"),
  CONSTRAINT "recovery_claims_credit_note_same_tenant_fk" FOREIGN KEY ("credit_note_id","restaurant_id")
    REFERENCES "credit_notes"("id","restaurant_id") ON DELETE SET NULL ("credit_note_id"),
  CONSTRAINT "recovery_claims_status_check" CHECK ("status" IN
    ('claimed', 'letter_sent', 'acknowledged', 'credited', 'recovered', 'disputed', 'written_off')),
  CONSTRAINT "recovery_claims_amount_check" CHECK ("amount_agorot" >= 0),
  CONSTRAINT "recovery_claims_credited_check" CHECK ("credited_agorot" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_claims_discrepancy_unique" ON "recovery_claims" ("discrepancy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_discrepancy_tenant_idx" ON "recovery_claims" ("discrepancy_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_restaurant_status_idx" ON "recovery_claims" ("restaurant_id", "status", "claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_supplier_idx" ON "recovery_claims" ("supplier_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_invoice_idx" ON "recovery_claims" ("invoice_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_credit_note_idx" ON "recovery_claims" ("credit_note_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_created_by_idx" ON "recovery_claims" ("created_by");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE CASCADE,
  "claim_id" uuid NOT NULL,
  "from_status" varchar(16),
  "to_status" varchar(16) NOT NULL,
  "amount_agorot" bigint,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recovery_events_claim_same_tenant_fk" FOREIGN KEY ("claim_id","restaurant_id")
    REFERENCES "recovery_claims"("id","restaurant_id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_claim_idx" ON "recovery_events" ("claim_id", "restaurant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_restaurant_idx" ON "recovery_events" ("restaurant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_events_actor_idx" ON "recovery_events" ("actor_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "recovery_claims_set_updated_at" ON "recovery_claims";--> statement-breakpoint
CREATE TRIGGER "recovery_claims_set_updated_at" BEFORE UPDATE ON "recovery_claims"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
-- Tenant RLS lives in this migration (not in drizzle/rls/0002): same shape as
-- 0002's per-restaurant policy. The helper is created exactly as rls/0002
-- defines it (idempotent) so a database migrated before provision-rls still
-- gets working policies.
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "credit_notes_tenant" ON "credit_notes";--> statement-breakpoint
CREATE POLICY "credit_notes_tenant" ON "credit_notes" USING (restaurant_id = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "recovery_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "recovery_claims_tenant" ON "recovery_claims";--> statement-breakpoint
CREATE POLICY "recovery_claims_tenant" ON "recovery_claims" USING (restaurant_id = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "recovery_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "recovery_events_tenant" ON "recovery_events";--> statement-breakpoint
CREATE POLICY "recovery_events_tenant" ON "recovery_events" USING (restaurant_id = app.current_restaurant_id());
