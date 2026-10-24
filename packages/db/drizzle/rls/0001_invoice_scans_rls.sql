-- ───────────────────────────────────────────────────────────────────────────
-- STORAGE isolation for invoice scans (Supabase Storage layer).
--
-- Apply on Supabase via the OWNER / direct connection (DATABASE_URL_DIRECT) —
-- storage.buckets / storage.objects are owned by supabase_storage_admin and the
-- `postgres` role can alter them; service_role and table owners BYPASS RLS by
-- design. See docs/PR1-storage-isolation-APPLY.md for the production runbook.
--
-- The per-restaurant invoice_scans TABLE policy lives in 0002_core_tenant_rls.sql
-- (`invoice_scans` is in its tenant-table loop). This file is ONLY the storage
-- layer: bucket privacy + storage.objects per-restaurant path-prefix isolation.
--
-- Tenancy key at the storage layer: the FIRST folder segment of the object name
-- is the owning restaurant id, e.g. '<restaurant_id>/<scan-id>.pdf'. There is
-- NO anonymous prefix (SB-3): the public showcase uploads server-side (service
-- role, POST /api/showcase/upload). app.current_restaurant_id() is set per-transaction by the app
-- (packages/api/src/trpc.ts memberProcedure → withRestaurant); it is NULL for
-- connections that never set it, so those see nothing tenant-scoped.
--
-- The policies are intentionally role-agnostic (no `to authenticated`): they are
-- gated on the GUC, so a connection only ever sees its own prefix, while
-- service_role (the app's real production storage path: server-side signed reads
-- + server-side uploads) bypasses RLS entirely. This is defense-in-depth — if a
-- non-service connection ever reaches storage.objects, the prefix gate still
-- isolates it. It also lets the CI attack-suite exercise the exact policy logic
-- against a vanilla-Postgres storage shim (see storage.attack.test.ts).
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Make the bucket private. After this the app MUST serve signed URLs
--    (createSignedUrl) instead of getPublicUrl(); /object/public/... 400s.
update storage.buckets set public = false where id = 'invoice-scans';

-- 2) storage.objects per-restaurant isolation by path prefix.
alter table storage.objects enable row level security;

-- ── Per-tenant: first path segment must equal the active restaurant id ──
drop policy if exists invoice_scans_tenant_select on storage.objects;
create policy invoice_scans_tenant_select on storage.objects
  for select
  using (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
  );

drop policy if exists invoice_scans_tenant_insert on storage.objects;
create policy invoice_scans_tenant_insert on storage.objects
  for insert
  with check (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
  );

drop policy if exists invoice_scans_tenant_update on storage.objects;
create policy invoice_scans_tenant_update on storage.objects
  for update
  using (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
  )
  with check (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
  );

drop policy if exists invoice_scans_tenant_delete on storage.objects;
create policy invoice_scans_tenant_delete on storage.objects
  for delete
  using (
    bucket_id = 'invoice-scans'
    and (storage.foldername(name))[1] = app.current_restaurant_id()::text
  );

-- ── SB-3: no anonymous storage access ──
-- The former anon 'walk-ins/' showcase policies are dropped (the showcase now
-- uploads via the service role). Kept as drops so re-applying this file on an
-- existing project removes them.
drop policy if exists invoice_scans_walkins_select on storage.objects;
drop policy if exists invoice_scans_walkins_insert on storage.objects;
