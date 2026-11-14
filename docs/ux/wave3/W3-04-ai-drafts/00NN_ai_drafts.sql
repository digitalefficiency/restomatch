-- 00NN_ai_drafts (W3-04b — "טיוטה של RestoMatch", flag `aiAssistant`)
-- PROPOSAL for the owner-signed schema train (item 4, after H-04). The number is
-- assigned by the train; the human PR copies this file to packages/db/drizzle/
-- and adds the journal entry. Agents do not edit drizzle/ (AGENTS.md immutability).
--
-- ai_drafts  a DRAFT the assistant wrote for a person to send or discard:
--            a credit-request letter, a supplier message, or an order note.
--            Draft-only: nothing is ever sent from this table. A person accepts
--            it (sent as is), edits it (sent after a change), or discards it.
--            Those outcomes drive the kill-switch: drafts turn OFF for a
--            restaurant when < 60 % of >= 20 decided drafts were used
--            (11/20 = 55 % → off; 12/20 = 60 % → on; 19 decided → never fires).
--
-- Money rule: the model never writes ₪. The body carries the {{amount}}
-- placeholder and the figure lives in amount_agorot (integer agorot) copied from
-- the engine / lib/claims basis; the web renders it through formatIls(). The
-- body_no_shekel CHECK is the DB backstop for buildDraft's llm_money refusal.
--
-- Decided consistency: status <> 'draft' exactly when decided_at is set.
-- decided_by is deliberately NOT tied by the CHECK: it is ON DELETE SET NULL, so
-- removing a user would violate a CHECK that required it on decided rows.
--
-- Tenant safety: restaurant_id + RLS in THIS migration, the 0057 pattern
-- byte-for-byte (0057_recipes.sql:84 `ALTER TABLE "recipes" ENABLE ROW LEVEL
-- SECURITY;` — ENABLE only, no FORCE — and the byte-identical
-- app.current_restaurant_id() reader), so the file is self-contained and
-- check-rls-completeness (every restaurant_id table has RLS) stays green with
-- no list entry. created_by / decided_by reference users with SET NULL so a
-- removed user does not erase the restaurant's history.
--
-- Additive only, idempotent. Rollback: DROP TABLE ai_drafts;
CREATE TABLE IF NOT EXISTS "ai_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "kind" varchar(32) NOT NULL,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "body" text NOT NULL,
  "basis_source" varchar(16) NOT NULL,
  "basis_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "amount_agorot" integer,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_drafts_kind_check" CHECK ("kind" IN ('creditRequest', 'supplierMessage', 'orderNote')),
  CONSTRAINT "ai_drafts_status_check" CHECK ("status" IN ('draft', 'accepted', 'edited', 'discarded')),
  CONSTRAINT "ai_drafts_basis_source_check" CHECK ("basis_source" IN ('engine', 'claims')),
  CONSTRAINT "ai_drafts_basis_refs_check" CHECK (jsonb_typeof("basis_refs") = 'array' AND jsonb_array_length("basis_refs") >= 1),
  CONSTRAINT "ai_drafts_amount_check" CHECK ("amount_agorot" IS NULL OR "amount_agorot" >= 0),
  CONSTRAINT "ai_drafts_body_nonempty_check" CHECK (btrim("body") <> ''),
  CONSTRAINT "ai_drafts_body_no_shekel_check" CHECK (position('₪' in "body") = 0),
  CONSTRAINT "ai_drafts_decided_consistent_check" CHECK (("status" = 'draft') = ("decided_at" IS NULL))
);--> statement-breakpoint
-- Kill-switch window + the per-restaurant list (newest first).
CREATE INDEX IF NOT EXISTS "ai_drafts_restaurant_created_idx" ON "ai_drafts" USING btree ("restaurant_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_drafts_restaurant_status_idx" ON "ai_drafts" USING btree ("restaurant_id", "status");--> statement-breakpoint
-- FK indexes (db:doctor "foreign keys indexed").
CREATE INDEX IF NOT EXISTS "ai_drafts_created_by_idx" ON "ai_drafts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_drafts_decided_by_idx" ON "ai_drafts" USING btree ("decided_by");--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_restaurant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;--> statement-breakpoint
ALTER TABLE "ai_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "ai_drafts_tenant" ON "ai_drafts";--> statement-breakpoint
CREATE POLICY "ai_drafts_tenant" ON "ai_drafts" USING ("restaurant_id" = app.current_restaurant_id());
