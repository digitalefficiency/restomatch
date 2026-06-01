-- ───────────────────────────────────────────────────────────────────────────
-- Harden invoice scan storage + table.  Apply during Phase-3 consolidation.
-- The `invoice-scans` bucket is currently PUBLIC (anyone with the URL can read).
-- ───────────────────────────────────────────────────────────────────────────

-- 1) Make the bucket private (dashboard or SQL). After this, the app MUST serve
--    signed URLs instead of getPublicUrl() — update apps/web/lib/supabase/*.
update storage.buckets set public = false where id = 'invoice-scans';

-- 2) Storage object RLS: only authenticated users may read invoice scans.
--    Tighten further with a path convention (name like '<restaurant_id>/%').
alter table storage.objects enable row level security;

drop policy if exists invoice_scans_read on storage.objects;
create policy invoice_scans_read on storage.objects
  for select
  to authenticated
  using (bucket_id = 'invoice-scans');

drop policy if exists invoice_scans_write on storage.objects;
create policy invoice_scans_write on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'invoice-scans');

-- 3) Table RLS for invoice_scans (per-restaurant). Requires restaurant_id to be
--    backfilled first (see 0002). Until then this policy denies rows with a NULL
--    restaurant_id — intended, so production rows must carry the tenant.
alter table invoice_scans enable row level security;

drop policy if exists invoice_scans_tenant on invoice_scans;
create policy invoice_scans_tenant on invoice_scans
  using (restaurant_id = app.current_restaurant_id());
