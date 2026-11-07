-- 0072_schema_batch_a (wave 2, H-03): the money pipeline and notification plumbing.
-- HUMAN-PR proposal, stacked on G-03's 0071. Every change is additive (nullable or
-- defaulted); no existing column changes meaning. No app code reads or writes these
-- objects in this PR: every reader ships in its own package after the deploy.
-- Nothing here touches a leak / discrepancy ₪ figure: no engine input, no LEAK_FILTER
-- column, no backfill.
--
-- Money units (AGENTS.md money facts): invoice-domain amounts are NUMERIC(12,2)
-- SHEKELS (invoices.paid_amount, suppliers.min_order_ils / delivery_fee_ils);
-- derived ledgers and snapshots are integer AGOROT bigint (export_runs.total_agorot,
-- leak_month_snapshots.leak_agorot, leak_month_corrections.delta_agorot).
--
-- invoices (+paid_at, paid_amount, payment_method, payment_ref)
--                        "שולם" as a fact. paid_at and paid_amount are both NULL or
--                        both set; method/ref only on a paid invoice. NO backfill:
--                        invoices already in status 'paid' keep paid_at NULL (=
--                        "unknown when"), because "caught before payment" is measured
--                        at decision time and a guessed paid_at would move it. No
--                        trigger or cascade touches recovery_claims / discrepancies:
--                        a paid invoice keeps its claims.
-- export_runs            one accounting export (Hashavshevet / Priority / Rivhit):
--                        who, when, the date range, mode 'new_only' | 'all', and the
--                        counts + total (agorot) as exported.
-- export_run_invoices    which invoices went out in which run, so 'new_only' can skip
--                        what was already exported (October never imported twice).
-- consolidated_invoice_links
--                        a consolidated invoice (חשבונית ריכוז) linked to the goods
--                        receipts it covers ('proposal_accept' | 'manual').
-- leak_month_snapshots   the frozen leak of a closed month (agorot + payload), per
--                        version. APPEND-ONLY (trigger: no UPDATE, and no DELETE
--                        from the tenant role): a printed month never
--                        restates; a re-close writes version n+1.
-- leak_month_corrections a late change against a frozen snapshot: signed delta
--                        (agorot), a mandatory reason, and the entity it came from.
--                        APPEND-ONLY (trigger).
-- recovery_claims (+seq_no)
--                        a per-restaurant claim reference number (nullable; unique
--                        per restaurant). Open point: may be redundant with 0071's
--                        claim_letters.seq_no; the human decides.
-- restaurants (+address, contact_phone)
--                        printed on the claim letter.
-- supplier_bank_accounts the supplier's bank details: bank/branch codes, the account
--                        number ENCRYPTED by the app (proposed: an AES-256-GCM helper
--                        in @restomatch/crypto, as apps/web/lib/totp.ts does) in
--                        account_number_enc, last4 for display, holder,
--                        who verified it and when. One ACTIVE account per supplier.
-- supplier_bank_account_changes
--                        the change audit (BEC fraud): before / after as MASKED jsonb
--                        (a CHECK refuses any account-number key). APPEND-ONLY.
-- suppliers (+min_order_ils, delivery_fee_ils)
--                        minimum order and delivery fee, shekels, >= 0.
-- po_lines / invoice_lines (+line_no)
--                        the printed line order (1-based), indexed with the parent.
-- supplier_catalog_items (+effective_from)
--                        the date a price-list row takes effect.
-- push_subscriptions     a Web Push endpoint per user device (unique per restaurant).
-- users (+whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_in_source)
--                        WhatsApp consent. The _at/_source pair is the PROPOSED
--                        stronger evidence (the human decides). The tenant app role
--                        has no INSERT/UPDATE/DELETE on users (rls.ts): the only
--                        writer is the auth/owner connection.
-- notification_prefs     per user × channel × event kind: on/off, quiet hours
--                        (23:00-06:00), Shabbat, daily cap (6, 1..50).
--
-- Tenant safety: the 0057/0070/0071 pattern. Every new table carries restaurant_id
-- NOT NULL, UNIQUE (id, restaurant_id), SAME-TENANT composite FKs to tenant tables,
-- and RLS enabled HERE with the `<table>_tenant` policy that drizzle/rls/0002 also
-- creates (they are in its table list). goods_receipts gains UNIQUE (id,
-- restaurant_id) (additive) so a link can point at it same-tenant. FKs to users stay
-- single-column: users is global (no restaurant_id).
--
-- Batch safety: no ALTER TYPE here, and nothing here uses 0071's new enum values
-- ('event', 'skipped'): both migrations run in ONE migrator transaction.
--
-- Locks: the Supabase CLI applies a file as ONE pipelined batch with no BEGIN, so a
-- top-level LOCK TABLE / SET LOCAL / SAVEPOINT is refused there (25P01) and nothing
-- applies. The prelude therefore (1) sets lock_timeout 5s and a 6s statement_timeout
-- with set_config(..., is_local => true), keeping the previous statement_timeout in
-- restomatch.prev_statement_timeout; (2) takes every lock in ONE DO block, parent-first
-- (0071's order), ACCESS EXCLUSIVE on the nine existing tables this file alters or
-- references (FK targets included), in an all-or-nothing NOWAIT retry loop, so nothing
-- waits holding a lock, nothing upgrades mid-file and nothing deadlocks; (3) restores
-- statement_timeout. A long reader makes the file fail fast (57014; 55P03 / 40P01 on
-- other paths) with nothing applied; re-run it in a quiet hour. There is no backfill: no row is read or
-- updated.
-- Stacked drizzle path: `pnpm db:migrate` applies 0071 + 0072 in ONE transaction, so
-- 0072's lock phase upgrades/extends 0071's locks mid-batch; a busy table then fails
-- the WHOLE batch fast (nothing applied). Re-run it.
--
-- App coupling: schema.ts names the new columns of EXISTING tables in every Drizzle
-- select/insert, so a build of main that carries this schema.ts fails against a DB
-- without 0072. Promote a build only after 0072 is confirmed applied (PR runbook).
--
-- Additive only, idempotent (IF NOT EXISTS / guarded DO blocks); a second run is a
-- no-op. Rollback = the ordered procedure in the PR body (app first, then this SQL,
-- then the tracker rows, with the rls/0002 list reverted in the same revert):
--   DROP TABLE notification_prefs, push_subscriptions, supplier_bank_account_changes,
--     supplier_bank_accounts, leak_month_corrections, leak_month_snapshots,
--     consolidated_invoice_links, export_run_invoices, export_runs;  -- their triggers go with them
--   DROP FUNCTION public.restomatch_append_only();                  -- after the triggers
--   ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_id_restaurant_id_key;
--   ALTER TABLE invoices DROP CONSTRAINT invoices_paid_pair_check,
--     DROP CONSTRAINT invoices_payment_requires_paid_check, DROP COLUMN paid_at,
--     DROP COLUMN paid_amount, DROP COLUMN payment_method, DROP COLUMN payment_ref;
--   ALTER TABLE recovery_claims DROP COLUMN seq_no;
--   ALTER TABLE restaurants DROP COLUMN address, DROP COLUMN contact_phone;
--   ALTER TABLE suppliers DROP COLUMN min_order_ils, DROP COLUMN delivery_fee_ils;
--   ALTER TABLE po_lines DROP COLUMN line_no; ALTER TABLE invoice_lines DROP COLUMN line_no;
--   ALTER TABLE supplier_catalog_items DROP COLUMN effective_from;
--   ALTER TABLE users DROP COLUMN whatsapp_opt_in, DROP COLUMN whatsapp_opt_in_at,
--     DROP COLUMN whatsapp_opt_in_source;
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1782500000000;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20260626185320', '20260626185321');

SELECT set_config('restomatch.prev_statement_timeout', current_setting('statement_timeout'), true),
       set_config('lock_timeout', '5s', true),
       set_config('statement_timeout', '6s', true);--> statement-breakpoint
-- All-or-nothing NOWAIT loop (as 0071): take every lock with NOWAIT; if any one is
-- busy, the sub-block rolls back and releases the locks it got, waits 50 ms and
-- tries again. Nothing is held while waiting, so no deadlock with a live
-- startReceipt (40P01), and the 6s statement_timeout bounds the loop (57014).
-- Order = 0071's parent-first order, restricted to this file's tables.
DO $$
BEGIN
  LOOP
    BEGIN
      LOCK TABLE "restaurants", "suppliers", "supplier_catalog_items" IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE "goods_receipts", "po_lines" IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE "invoices", "invoice_lines" IN ACCESS EXCLUSIVE MODE NOWAIT;
      LOCK TABLE "recovery_claims", "users" IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(0.05);
    END;
  END LOOP;
END $$;--> statement-breakpoint
-- Restore. If the saved value is gone (an applier that commits per statement already
-- reverted the local setting), keep the current one.
SELECT set_config('statement_timeout',
  coalesce(nullif(current_setting('restomatch.prev_statement_timeout', true), ''), current_setting('statement_timeout')),
  true);--> statement-breakpoint

-- ── shared: append-only guard (frozen snapshots, corrections, bank audit) ─────
-- BEFORE UPDATE OR DELETE. "Owner" = the table owner's connection (migrations, ops,
-- tests) — referential cascades also run as the owner, so a restaurant delete still
-- cascades. The tenant app role can never DELETE a row, and can never UPDATE one.
-- The trigger arguments name the actor columns (FK → users ON DELETE SET NULL): an
-- UPDATE that only nulls those is let through inside a referential action (trigger
-- depth > 1) or on the owner connection (DSR erasure); any other UPDATE raises.
-- (A revoke in rls.ts would be the belt to this brace; proposed in the PR body.)
CREATE OR REPLACE FUNCTION public.restomatch_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  is_owner boolean := pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = TG_RELID), 'MEMBER');
  o jsonb;
  n jsonb;
  c text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF is_owner THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only: rows are never deleted', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  o := to_jsonb(OLD);
  n := to_jsonb(NEW);
  IF TG_NARGS > 0 AND (pg_trigger_depth() > 1 OR is_owner) THEN
    FOREACH c IN ARRAY TG_ARGV LOOP
      IF n -> c = 'null'::jsonb THEN
        o := o - c;
        n := n - c;
      END IF;
    END LOOP;
  END IF;
  IF o = n THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: rows are never updated', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint

-- ── invoices: payment facts ───────────────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "paid_amount" numeric(12, 2)
  CONSTRAINT "invoices_paid_amount_nonneg_check" CHECK ("paid_amount" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_method" varchar(16)
  CONSTRAINT "invoices_payment_method_check" CHECK ("payment_method" IN ('bank_transfer', 'check', 'cash', 'card', 'offset', 'other'));--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_ref" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_paid_pair_check') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_pair_check"
      CHECK (("paid_at" IS NULL) = ("paid_amount" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_payment_requires_paid_check') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_requires_paid_check"
      CHECK ("paid_at" IS NOT NULL OR ("payment_method" IS NULL AND "payment_ref" IS NULL));
  END IF;
END $$;--> statement-breakpoint

-- ── export_runs + export_run_invoices ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "export_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "range_from" date NOT NULL,
  "range_to" date NOT NULL,
  "format" varchar(16) NOT NULL,
  "mode" varchar(16) NOT NULL,
  "invoice_count" integer DEFAULT 0 NOT NULL,
  "total_agorot" bigint DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "replaced_chars" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "export_runs_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "export_runs_format_check" CHECK ("format" IN ('hashavshevet', 'priority', 'rivhit', 'csv')),
  CONSTRAINT "export_runs_mode_check" CHECK ("mode" IN ('new_only', 'all')),
  CONSTRAINT "export_runs_range_check" CHECK ("range_to" >= "range_from"),
  CONSTRAINT "export_runs_counts_check" CHECK ("invoice_count" >= 0 AND "skipped_count" >= 0 AND "replaced_chars" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_runs_restaurant_created_idx" ON "export_runs" USING btree ("restaurant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_runs_created_by_idx" ON "export_runs" USING btree ("created_by");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "export_run_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "export_run_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  CONSTRAINT "export_run_invoices_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "export_run_invoices_run_invoice_key" UNIQUE ("export_run_id", "invoice_id"),
  CONSTRAINT "export_run_invoices_run_same_tenant_fk" FOREIGN KEY ("export_run_id", "restaurant_id")
    REFERENCES "public"."export_runs"("id", "restaurant_id") ON DELETE cascade,
  -- An exported invoice is in the bookkeeper's books: it cannot be deleted from under
  -- the log (NO ACTION, checked at statement end, so a restaurant delete still cascades).
  CONSTRAINT "export_run_invoices_invoice_same_tenant_fk" FOREIGN KEY ("invoice_id", "restaurant_id")
    REFERENCES "public"."invoices"("id", "restaurant_id") ON DELETE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_run_invoices_run_idx" ON "export_run_invoices" USING btree ("export_run_id", "restaurant_id");--> statement-breakpoint
-- "not yet exported": NOT EXISTS (… where invoice_id = i.id and restaurant_id = i.restaurant_id).
CREATE INDEX IF NOT EXISTS "export_run_invoices_invoice_idx" ON "export_run_invoices" USING btree ("invoice_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_run_invoices_restaurant_idx" ON "export_run_invoices" USING btree ("restaurant_id");--> statement-breakpoint

-- ── consolidated_invoice_links ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_receipts_id_restaurant_id_key') THEN
    ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_id_restaurant_id_key" UNIQUE ("id", "restaurant_id");
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consolidated_invoice_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "invoice_id" uuid NOT NULL,
  "goods_receipt_id" uuid NOT NULL,
  "linked_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" varchar(16) NOT NULL,
  CONSTRAINT "consolidated_invoice_links_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "consolidated_invoice_links_invoice_gr_key" UNIQUE ("invoice_id", "goods_receipt_id"),
  CONSTRAINT "consolidated_invoice_links_invoice_same_tenant_fk" FOREIGN KEY ("invoice_id", "restaurant_id")
    REFERENCES "public"."invoices"("id", "restaurant_id") ON DELETE cascade,
  CONSTRAINT "consolidated_invoice_links_gr_same_tenant_fk" FOREIGN KEY ("goods_receipt_id", "restaurant_id")
    REFERENCES "public"."goods_receipts"("id", "restaurant_id") ON DELETE cascade,
  CONSTRAINT "consolidated_invoice_links_source_check" CHECK ("source" IN ('proposal_accept', 'manual'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consolidated_invoice_links_invoice_idx" ON "consolidated_invoice_links" USING btree ("invoice_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consolidated_invoice_links_gr_idx" ON "consolidated_invoice_links" USING btree ("goods_receipt_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consolidated_invoice_links_linked_by_idx" ON "consolidated_invoice_links" USING btree ("linked_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consolidated_invoice_links_restaurant_idx" ON "consolidated_invoice_links" USING btree ("restaurant_id", "linked_at");--> statement-breakpoint

-- ── leak_month_snapshots + leak_month_corrections (append-only) ───────────────
CREATE TABLE IF NOT EXISTS "leak_month_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "month" date NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "leak_agorot" bigint NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "leak_month_snapshots_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "leak_month_snapshots_month_version_key" UNIQUE ("restaurant_id", "month", "version"),
  CONSTRAINT "leak_month_snapshots_month_day1_check" CHECK (EXTRACT(DAY FROM "month") = 1),
  CONSTRAINT "leak_month_snapshots_version_check" CHECK ("version" >= 1),
  CONSTRAINT "leak_month_snapshots_leak_check" CHECK ("leak_agorot" >= 0)
);--> statement-breakpoint
DROP TRIGGER IF EXISTS "leak_month_snapshots_append_only" ON "leak_month_snapshots";--> statement-breakpoint
CREATE TRIGGER "leak_month_snapshots_append_only" BEFORE UPDATE OR DELETE ON "leak_month_snapshots" FOR EACH ROW EXECUTE FUNCTION public.restomatch_append_only();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leak_month_corrections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "snapshot_id" uuid NOT NULL,
  "delta_agorot" bigint NOT NULL,
  "reason" text NOT NULL,
  "entity_type" varchar(32),
  "entity_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "leak_month_corrections_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- A correction is evidence against a frozen month: its snapshot cannot be deleted
  -- from under it (NO ACTION; a restaurant delete still cascades through both).
  CONSTRAINT "leak_month_corrections_snapshot_same_tenant_fk" FOREIGN KEY ("snapshot_id", "restaurant_id")
    REFERENCES "public"."leak_month_snapshots"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "leak_month_corrections_delta_check" CHECK ("delta_agorot" <> 0),
  CONSTRAINT "leak_month_corrections_reason_check" CHECK (btrim("reason") <> '')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leak_month_corrections_snapshot_idx" ON "leak_month_corrections" USING btree ("snapshot_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leak_month_corrections_entity_idx" ON "leak_month_corrections" USING btree ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leak_month_corrections_created_by_idx" ON "leak_month_corrections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leak_month_corrections_restaurant_idx" ON "leak_month_corrections" USING btree ("restaurant_id", "created_at");--> statement-breakpoint
DROP TRIGGER IF EXISTS "leak_month_corrections_append_only" ON "leak_month_corrections";--> statement-breakpoint
CREATE TRIGGER "leak_month_corrections_append_only" BEFORE UPDATE OR DELETE ON "leak_month_corrections" FOR EACH ROW EXECUTE FUNCTION public.restomatch_append_only('created_by');--> statement-breakpoint

-- ── recovery_claims.seq_no / restaurants address + phone ──────────────────────
ALTER TABLE "recovery_claims" ADD COLUMN IF NOT EXISTS "seq_no" integer
  CONSTRAINT "recovery_claims_seq_check" CHECK ("seq_no" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_claims_restaurant_seq_unique" ON "recovery_claims" USING btree ("restaurant_id", "seq_no");--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "contact_phone" varchar(32);--> statement-breakpoint

-- ── supplier_bank_accounts + supplier_bank_account_changes ────────────────────
CREATE TABLE IF NOT EXISTS "supplier_bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "supplier_id" uuid NOT NULL,
  "bank_code" varchar(3) NOT NULL,
  "branch_code" varchar(4) NOT NULL,
  -- Ciphertext only (@restomatch/crypto envelope). Never the plain number.
  "account_number_enc" text NOT NULL,
  "account_last4" varchar(4) NOT NULL,
  "holder_name" text,
  "verified_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "verified_at" timestamp with time zone,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "supplier_bank_accounts_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- Bank details are payment evidence: the supplier cannot be deleted from under them
  -- (NO ACTION; suppliers are soft-deactivated, and a restaurant delete still cascades).
  CONSTRAINT "supplier_bank_accounts_supplier_same_tenant_fk" FOREIGN KEY ("supplier_id", "restaurant_id")
    REFERENCES "public"."suppliers"("id", "restaurant_id") ON DELETE no action,
  CONSTRAINT "supplier_bank_accounts_bank_code_check" CHECK ("bank_code" ~ '^[0-9]{2,3}$'),
  CONSTRAINT "supplier_bank_accounts_branch_code_check" CHECK ("branch_code" ~ '^[0-9]{3,4}$'),
  CONSTRAINT "supplier_bank_accounts_last4_check" CHECK ("account_last4" ~ '^[0-9]{1,4}$'),
  CONSTRAINT "supplier_bank_accounts_enc_nonempty_check" CHECK (btrim("account_number_enc") <> '')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_accounts_supplier_idx" ON "supplier_bank_accounts" USING btree ("supplier_id", "restaurant_id");--> statement-breakpoint
-- One ACTIVE account per supplier: a change deactivates the old row and inserts a new one.
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_bank_accounts_one_active" ON "supplier_bank_accounts" USING btree ("supplier_id") WHERE "active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_accounts_restaurant_idx" ON "supplier_bank_accounts" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_accounts_verified_by_idx" ON "supplier_bank_accounts" USING btree ("verified_by");--> statement-breakpoint
DROP TRIGGER IF EXISTS "supplier_bank_accounts_set_updated_at" ON "supplier_bank_accounts";--> statement-breakpoint
CREATE TRIGGER "supplier_bank_accounts_set_updated_at" BEFORE UPDATE ON "supplier_bank_accounts" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_bank_account_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "bank_account_id" uuid NOT NULL,
  "changed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "before" jsonb,
  "after" jsonb NOT NULL,
  CONSTRAINT "supplier_bank_account_changes_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- The audit outlives nothing it describes: its account cannot be deleted (NO ACTION).
  CONSTRAINT "supplier_bank_account_changes_account_same_tenant_fk" FOREIGN KEY ("bank_account_id", "restaurant_id")
    REFERENCES "public"."supplier_bank_accounts"("id", "restaurant_id") ON DELETE no action,
  -- MASKED only: neither side may carry the account number or its ciphertext.
  CONSTRAINT "supplier_bank_account_changes_masked_check" CHECK (
    NOT (coalesce("before", '{}'::jsonb) ?| ARRAY['account_number', 'account_number_enc', 'accountNumber', 'accountNumberEnc'])
    AND NOT ("after" ?| ARRAY['account_number', 'account_number_enc', 'accountNumber', 'accountNumberEnc'])
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_account_changes_account_idx" ON "supplier_bank_account_changes" USING btree ("bank_account_id", "restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_account_changes_changed_by_idx" ON "supplier_bank_account_changes" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_bank_account_changes_restaurant_idx" ON "supplier_bank_account_changes" USING btree ("restaurant_id", "changed_at");--> statement-breakpoint
DROP TRIGGER IF EXISTS "supplier_bank_account_changes_append_only" ON "supplier_bank_account_changes";--> statement-breakpoint
CREATE TRIGGER "supplier_bank_account_changes_append_only" BEFORE UPDATE OR DELETE ON "supplier_bank_account_changes" FOR EACH ROW EXECUTE FUNCTION public.restomatch_append_only('changed_by');--> statement-breakpoint

-- ── suppliers min order / fee; line order; price-list date ────────────────────
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "min_order_ils" numeric(12, 2)
  CONSTRAINT "suppliers_min_order_ils_check" CHECK ("min_order_ils" >= 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "delivery_fee_ils" numeric(12, 2)
  CONSTRAINT "suppliers_delivery_fee_ils_check" CHECK ("delivery_fee_ils" >= 0);--> statement-breakpoint
ALTER TABLE "po_lines" ADD COLUMN IF NOT EXISTS "line_no" integer
  CONSTRAINT "po_lines_line_no_check" CHECK ("line_no" >= 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_lines_po_line_no_idx" ON "po_lines" USING btree ("po_id", "line_no");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN IF NOT EXISTS "line_no" integer
  CONSTRAINT "invoice_lines_line_no_check" CHECK ("line_no" >= 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_line_no_idx" ON "invoice_lines" USING btree ("invoice_id", "line_no");--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD COLUMN IF NOT EXISTS "effective_from" date;--> statement-breakpoint

-- ── push_subscriptions / users WhatsApp consent / notification_prefs ──────────
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "push_subscriptions_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  -- Per restaurant: one device of a user in two restaurants has one row in each, and
  -- a tenant never learns (by a unique violation) that another tenant holds it.
  CONSTRAINT "push_subscriptions_restaurant_endpoint_key" UNIQUE ("restaurant_id", "endpoint"),
  CONSTRAINT "push_subscriptions_endpoint_https_check" CHECK ("endpoint" LIKE 'https://%')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_restaurant_user_idx" ON "push_subscriptions" USING btree ("restaurant_id", "user_id");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in_source" varchar(16)
  CONSTRAINT "users_whatsapp_opt_in_source_check" CHECK ("whatsapp_opt_in_source" IN ('settings', 'onboarding', 'whatsapp_reply', 'admin'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_prefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "channel" varchar(16) NOT NULL,
  "event_kind" varchar(48) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "quiet_start" time DEFAULT '23:00' NOT NULL,
  "quiet_end" time DEFAULT '06:00' NOT NULL,
  "observe_shabbat" boolean DEFAULT true NOT NULL,
  "daily_cap" smallint DEFAULT 6 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_prefs_id_restaurant_id_key" UNIQUE ("id", "restaurant_id"),
  CONSTRAINT "notification_prefs_user_channel_kind_key" UNIQUE ("restaurant_id", "user_id", "channel", "event_kind"),
  CONSTRAINT "notification_prefs_channel_check" CHECK ("channel" IN ('email', 'whatsapp', 'push')),
  CONSTRAINT "notification_prefs_event_kind_nonempty_check" CHECK (btrim("event_kind") <> ''),
  CONSTRAINT "notification_prefs_daily_cap_check" CHECK ("daily_cap" BETWEEN 1 AND 50)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_prefs_user_idx" ON "notification_prefs" USING btree ("user_id");--> statement-breakpoint
DROP TRIGGER IF EXISTS "notification_prefs_set_updated_at" ON "notification_prefs";--> statement-breakpoint
CREATE TRIGGER "notification_prefs_set_updated_at" BEFORE UPDATE ON "notification_prefs" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ── RLS on the nine new tenant tables (also in rls/0002's list) ───────────────
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "export_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "export_runs_tenant" ON "export_runs";--> statement-breakpoint
CREATE POLICY "export_runs_tenant" ON "export_runs" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "export_run_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "export_run_invoices_tenant" ON "export_run_invoices";--> statement-breakpoint
CREATE POLICY "export_run_invoices_tenant" ON "export_run_invoices" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "consolidated_invoice_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "consolidated_invoice_links_tenant" ON "consolidated_invoice_links";--> statement-breakpoint
CREATE POLICY "consolidated_invoice_links_tenant" ON "consolidated_invoice_links" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "leak_month_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "leak_month_snapshots_tenant" ON "leak_month_snapshots";--> statement-breakpoint
CREATE POLICY "leak_month_snapshots_tenant" ON "leak_month_snapshots" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "leak_month_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "leak_month_corrections_tenant" ON "leak_month_corrections";--> statement-breakpoint
CREATE POLICY "leak_month_corrections_tenant" ON "leak_month_corrections" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "supplier_bank_accounts_tenant" ON "supplier_bank_accounts";--> statement-breakpoint
CREATE POLICY "supplier_bank_accounts_tenant" ON "supplier_bank_accounts" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "supplier_bank_account_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "supplier_bank_account_changes_tenant" ON "supplier_bank_account_changes";--> statement-breakpoint
CREATE POLICY "supplier_bank_account_changes_tenant" ON "supplier_bank_account_changes" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "push_subscriptions_tenant" ON "push_subscriptions";--> statement-breakpoint
CREATE POLICY "push_subscriptions_tenant" ON "push_subscriptions" USING ("restaurant_id" = app.current_restaurant_id());--> statement-breakpoint
ALTER TABLE "notification_prefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_prefs_tenant" ON "notification_prefs";--> statement-breakpoint
CREATE POLICY "notification_prefs_tenant" ON "notification_prefs" USING ("restaurant_id" = app.current_restaurant_id());
