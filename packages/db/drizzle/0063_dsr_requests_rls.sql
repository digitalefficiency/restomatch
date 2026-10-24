-- dsr_requests (0022): the append-only data-subject-rights audit trail. It has no
-- restaurant_id (a DSR subject is a platform user or a marketing lead), so it never
-- got tenant RLS, and it is meant to be reached only through the owner/admin
-- connection (the dsr router's adminConn, the admin console, the worker).
--
-- But the blanket "grant select, insert, update, delete on all tables" in
-- packages/db/src/rls.ts (provision-rls, and the Supabase RLS snapshot that runs
-- after the migrations) gives the tenant app role full DML on it: any tenant
-- session could read every DSR subject's email and details, and delete the trail.
--
-- Same fix as 0061 for its owner-only tables: RLS ENABLED with a deny-all policy,
-- so whatever the grants say, restomatch_app reads and writes no row. The owner
-- role owns the table and bypasses RLS (RLS is not FORCEd), so the DSR flow is
-- unchanged. Additive and online-safe: no data change.
--
-- Hand-written (drizzle-kit generate is broken in this repo).
ALTER TABLE "dsr_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "dsr_requests_no_tenant_access" ON "dsr_requests";--> statement-breakpoint
CREATE POLICY "dsr_requests_no_tenant_access" ON "dsr_requests" FOR ALL USING (false) WITH CHECK (false);
