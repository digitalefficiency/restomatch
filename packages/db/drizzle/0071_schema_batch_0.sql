-- 0071_schema_batch_0 (wave 2, G-03): the facts the money loop is missing.
-- HUMAN-PR proposal. Every change is additive (nullable or defaulted); no existing
-- column changes meaning. No app code reads or writes these objects in this PR:
-- every reader keeps its interim until its own package rebases onto the deploy.
--
-- gr_lines (+counted_at, counted_by, count_method, updated_at)
--                        count truth per receipt line: WHEN it was counted, by WHOM,
--                        and HOW ('line' = counted item by item, 'bulk_as_ordered' =
--                        "all arrived as ordered", 'legacy' = closed before this
--                        column existed). updated_at + the house trigger.
--                        Legacy backfill (owner decision 24) is the separate,
--                        idempotent UPDATE further down.
-- idempotency_keys       one row per (restaurant, client key): the procedure, the
--                        caller, a hash of the request and the recorded response,
--                        so a retried mutation returns the first answer.
-- purchase_orders (+kind, po_number)
--                        kind 'standard' | 'walk_in' (a retro PO opened at the dock);
--                        po_number = the order number as printed/sent.
-- goods_receipts (+delivery_note_number)
--                        the supplier's printed delivery-note (תעודת משלוח) number.
-- discrepancies (+decision, basis, escalated_from_role, escalated_by)
--                        the decision taken on a פער, the jsonb basis it was taken on
--                        (the ₪ and refs shown at decision time), and who escalated
--                        it from which role.
-- claim_letters          one credit-claim letter (דרישת זיכוי) to one supplier: its
--                        own per-restaurant seq_no, status draft|sent|answered|closed,
--                        channel, sent_at, the reply-by date, the frozen content and a
--                        version. recovery_claims (+letter_id) points at the letter
--                        it went out in (same-tenant composite FK).
-- payment_deductions     a SHORT-PAY record: ₪ (integer agorot) held back from an
--                        invoice's payment, optionally for a claim. It is never a
--                        credit note and never changes the invoice or the claim.
-- product_aliases (+source)
--                        alias provenance: 'human' | 'exact_key' | 'new_product' |
--                        'import_guess' | 'legacy' (every pre-existing alias).
-- users (+phone_verified_at)
--                        when the phone number was verified. The tenant app role has
--                        no INSERT/UPDATE/DELETE on users (rls.ts), so the only writer
--                        is the auth/owner connection.
-- enum values            activity_event_type += 'event' (the kind lives in
--                        metadata.kind); notification_status += 'skipped'.
--
-- Tenant safety: the 0057/0070 pattern. The three new tables carry restaurant_id
-- NOT NULL, UNIQUE (id, restaurant_id), SAME-TENANT composite FKs to tenant tables,
-- and RLS enabled HERE with the `<table>_tenant` policy that drizzle/rls/0002 also
-- creates (they are in its table list). FKs to users stay single-column: users is
-- global (no restaurant_id), as in every other table.
--
-- Enum values: `pnpm db:migrate` applies all pending journal entries in ONE
-- transaction. Postgres >= 12 allows ALTER TYPE ... ADD VALUE inside a transaction,
-- but the new value cannot be USED until that transaction commits. So the two
-- ADD VALUE statements are separate statements at the very end of this file and
-- nothing in this migration — or in any migration applied in the same batch (H-03's
-- 0072) — may reference 'event' or 'skipped'. App code starts writing them only
-- after the deploy.
--
-- Additive only, idempotent (IF NOT EXISTS / guarded DO blocks); a second run is a
-- no-op. Rollback (enum values cannot be dropped and stay harmless):
--   ALTER TABLE recovery_claims DROP COLUMN letter_id; DROP TABLE payment_deductions;
--   DROP TABLE claim_letters; DROP TABLE idempotency_keys;
--   ALTER TABLE gr_lines DROP COLUMN counted_at, DROP COLUMN counted_by,
--     DROP COLUMN count_method, DROP COLUMN updated_at;
--   ALTER TABLE purchase_orders DROP COLUMN kind, DROP COLUMN po_number;
--   ALTER TABLE goods_receipts DROP COLUMN delivery_note_number;
--   ALTER TABLE discrepancies DROP COLUMN decision, DROP COLUMN basis,
--     DROP COLUMN escalated_from_role, DROP COLUMN escalated_by;
--   ALTER TABLE product_aliases DROP COLUMN source; ALTER TABLE users DROP COLUMN phone_verified_at;

-- ── gr_lines: count truth ─────────────────────────────────────────────────────
ALTER TABLE "gr_lines" ADD COLUMN IF NOT EXISTS "counted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gr_lines" ADD COLUMN IF NOT EXISTS "counted_by" uuid
  CONSTRAINT "gr_lines_counted_by_users_id_fk" REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "gr_lines" ADD COLUMN IF NOT EXISTS "count_method" varchar(16)
  CONSTRAINT "gr_lines_count_method_check" CHECK ("count_method" IN ('line', 'bulk_as_ordered', 'legacy'));--> statement-breakpoint
ALTER TABLE "gr_lines" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gr_lines_counted_by_idx" ON "gr_lines" USING btree ("counted_by");--> statement-breakpoint
-- Legacy backfill (owner decision 24, data fix): every line of a CLOSED receipt
-- (completed | partial) that has no count stamp gets the receipt's completion time
-- and method 'legacy'. goods_receipts has no completed_at: completeReceipt stamps
-- updated_at = now() when it closes the receipt, so updated_at is that time (a later
-- edit of the receipt can only move it later, never before the close). counted_by
-- stays NULL: who counted is unknown. Idempotent: only rows still unstamped.
-- Lines that break 0032's NOT VALID checks (a negative qty_received/qty_rejected)
-- are SKIPPED: an UPDATE re-checks every CHECK on the row, so stamping one would
-- abort the whole migration batch. They stay unstamped; db:doctor already lists them.
UPDATE "gr_lines" AS gl
SET "counted_at" = g."updated_at", "count_method" = 'legacy'
FROM "goods_receipts" AS g
WHERE g."id" = gl."gr_id"
  AND g."status" IN ('completed', 'partial')
  AND gl."counted_at" IS NULL
  AND gl."qty_received" >= 0
  AND gl."qty_rejected" >= 0;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gr_lines_set_updated_at" ON "gr_lines";--> statement-breakpoint
CREATE TRIGGER "gr_lines_set_updated_at" BEFORE UPDATE ON "gr_lines" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ── idempotency_keys ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "key" varchar(128) NOT NULL,
  "procedure" varchar(128) NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "request_hash" varchar(64),
  "response" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idempotency_keys_restaurant_key_key" UNIQUE ("restaurant_id", "key"),
  CONSTRAINT "idempotency_keys_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "idempotency_keys_key_nonempty_check" CHECK (btrim("key") <> ''),
  CONSTRAINT "idempotency_keys_procedure_nonempty_check" CHECK (btrim("procedure") <> '')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_user_idx" ON "idempotency_keys" USING btree ("user_id");--> statement-breakpoint
-- For the expiry sweep (old keys are deleted by age).
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint

-- ── purchase_orders / goods_receipts: walk-in POs and printed numbers ──────────
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "kind" varchar(16) DEFAULT 'standard' NOT NULL
  CONSTRAINT "purchase_orders_kind_check" CHECK ("kind" IN ('standard', 'walk_in'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "po_number" varchar(64);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN IF NOT EXISTS "delivery_note_number" varchar(64);--> statement-breakpoint

-- ── discrepancies: the decision behind each פער ────────────────────────────────
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "decision" varchar(24)
  CONSTRAINT "discrepancies_decision_check" CHECK ("decision" IN
    ('claim', 'waive', 'acknowledge', 'hold_duplicate', 'release_duplicate', 'link_po', 'tolerate'));--> statement-breakpoint
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "basis" jsonb;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "escalated_from_role" "user_role";--> statement-breakpoint
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "escalated_by" uuid
  CONSTRAINT "discrepancies_escalated_by_users_id_fk" REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discrepancies_escalated_by_idx" ON "discrepancies" USING btree ("escalated_by");--> statement-breakpoint

-- ── claim_letters + recovery_claims.letter_id ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "claim_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "supplier_id" uuid NOT NULL,
  "seq_no" integer NOT NULL,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "channel" varchar(16),
  "sent_at" timestamp with time zone,
  "reply_by" date,
  "content_snapshot" jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "claim_letters_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- One running letter number per restaurant.
  CONSTRAINT "claim_letters_restaurant_seq_key" UNIQUE ("restaurant_id", "seq_no"),
  -- A letter is evidence: its supplier cannot be deleted from under it (NO ACTION is
  -- checked at statement end, so deleting the whole restaurant still cascades).
  CONSTRAINT "claim_letters_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id", "restaurant_id")
    REFERENCES "public"."suppliers"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "claim_letters_status_check" CHECK ("status" IN ('draft', 'sent', 'answered', 'closed')),
  CONSTRAINT "claim_letters_seq_check" CHECK ("seq_no" > 0),
  CONSTRAINT "claim_letters_version_check" CHECK ("version" >= 1)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_letters_supplier_idx" ON "claim_letters" USING btree ("supplier_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_letters_restaurant_status_idx" ON "claim_letters" USING btree ("restaurant_id", "status");--> statement-breakpoint
DROP TRIGGER IF EXISTS "claim_letters_set_updated_at" ON "claim_letters";--> statement-breakpoint
CREATE TRIGGER "claim_letters_set_updated_at" BEFORE UPDATE ON "claim_letters" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
ALTER TABLE "recovery_claims" ADD COLUMN IF NOT EXISTS "letter_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recovery_claims_letter_same_tenant_fk') THEN
    ALTER TABLE "recovery_claims" ADD CONSTRAINT "recovery_claims_letter_same_tenant_fk"
      FOREIGN KEY ("letter_id", "restaurant_id")
      REFERENCES "public"."claim_letters"("id", "restaurant_id") ON DELETE SET NULL ("letter_id");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_claims_letter_idx" ON "recovery_claims" USING btree ("letter_id", "restaurant_id");--> statement-breakpoint

-- ── payment_deductions: short-pay records (never a credit note) ───────────────
CREATE TABLE IF NOT EXISTS "payment_deductions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "invoice_id" uuid NOT NULL,
  "claim_id" uuid,
  "amount_agorot" bigint NOT NULL,
  "vat_basis" varchar(16) DEFAULT 'incl_vat' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_deductions_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- A money record: its invoice cannot be deleted from under it (NO ACTION, so a
  -- restaurant delete still cascades through both).
  CONSTRAINT "payment_deductions_invoice_same_tenant_fk" FOREIGN KEY ("invoice_id", "restaurant_id")
    REFERENCES "public"."invoices"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "payment_deductions_claim_same_tenant_fk" FOREIGN KEY ("claim_id", "restaurant_id")
    REFERENCES "public"."recovery_claims"("id", "restaurant_id") ON DELETE SET NULL ("claim_id"),
  CONSTRAINT "payment_deductions_amount_check" CHECK ("amount_agorot" > 0),
  CONSTRAINT "payment_deductions_vat_basis_check" CHECK ("vat_basis" IN ('incl_vat', 'excl_vat'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_deductions_invoice_idx" ON "payment_deductions" USING btree ("invoice_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_deductions_claim_idx" ON "payment_deductions" USING btree ("claim_id", "restaurant_id");--> statement-breakpoint
-- restaurant_id FK lookups + "this restaurant's deductions, newest first".
CREATE INDEX IF NOT EXISTS "payment_deductions_restaurant_idx" ON "payment_deductions" USING btree ("restaurant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_deductions_created_by_idx" ON "payment_deductions" USING btree ("created_by");--> statement-breakpoint

-- ── product_aliases.source / users.phone_verified_at ──────────────────────────
ALTER TABLE "product_aliases" ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'legacy' NOT NULL
  CONSTRAINT "product_aliases_source_check" CHECK ("source" IN ('human', 'exact_key', 'new_product', 'import_guess', 'legacy'));--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;--> statement-breakpoint

-- ── RLS on the three new tenant tables (also in rls/0002's list) ──────────────
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "idempotency_keys_tenant" ON "idempotency_keys";--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant" ON "idempotency_keys" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "claim_letters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "claim_letters_tenant" ON "claim_letters";--> statement-breakpoint
CREATE POLICY "claim_letters_tenant" ON "claim_letters" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "payment_deductions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "payment_deductions_tenant" ON "payment_deductions";--> statement-breakpoint
CREATE POLICY "payment_deductions_tenant" ON "payment_deductions" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint

-- ── enum values: LAST, separate statements, unused in this batch (see header) ──
ALTER TYPE "public"."activity_event_type" ADD VALUE IF NOT EXISTS 'event';--> statement-breakpoint
ALTER TYPE "public"."notification_status" ADD VALUE IF NOT EXISTS 'skipped';
