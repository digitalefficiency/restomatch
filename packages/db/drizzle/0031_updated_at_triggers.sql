-- 0031 — `updated_at` is maintained by the database, not by every call site.
--
-- Thirteen tables carry updated_at DEFAULT now(), but nothing ever moved it after
-- the INSERT except the ~27 call sites that remember to `set({ updatedAt: new Date() })`.
-- Everything else (status flips on invoices/POs, receipt completion, supplier
-- edits, Auth.js user updates…) left a stale timestamp, which makes "recently
-- changed" lists, sync cursors and audits lie.
--
-- One BEFORE UPDATE trigger function, attached to every public table that has an
-- updated_at column (discovered at apply time, so a table added later with the
-- same column is picked up by re-running this file; `pnpm db:doctor` flags any
-- table that has the column but not the trigger). It bumps updated_at only when
-- the UPDATE did not set it explicitly — so the existing call sites, seeds and
-- backfills that write a specific timestamp keep their value.
--
-- No precondition, no data rewrite (triggers fire on future UPDATEs only).
-- SECURITY: plain (invoker) plpgsql, no table access; trigger functions need no
-- EXECUTE grant for the RLS app role. Idempotent (CREATE OR REPLACE + DROP IF EXISTS).
--
-- Rollback: DROP FUNCTION public.set_updated_at() CASCADE;  (drops the triggers too)
--
-- Hand-written (drizzle-kit generate is broken in this repo).
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t || '_set_updated_at', t
    );
  END LOOP;
END $$;
