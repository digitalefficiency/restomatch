-- ───────────────────────────────────────────────────────────────────────────
-- Per-restaurant Row-Level Security for RestoMatch core tables.
-- Apply during Phase-3 Supabase consolidation (NOT via pnpm db:migrate).
--
-- Tenancy key: every protected row carries restaurant_id. The app sets the
-- active restaurant per transaction:  SET LOCAL app.current_restaurant_id = '<uuid>';
-- Apply on a role that is NOT the table owner / NOT service_role (both bypass RLS).
-- ───────────────────────────────────────────────────────────────────────────

create schema if not exists app;

-- Reads the active restaurant from the per-transaction GUC (NULL if unset).
create or replace function app.current_restaurant_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;

-- The root tenant table keys on `id` rather than `restaurant_id`.
alter table restaurants enable row level security;
drop policy if exists restaurants_tenant on restaurants;
create policy restaurants_tenant on restaurants
  using (id = app.current_restaurant_id());

-- Every table that carries restaurant_id gets the same per-restaurant policy.
-- Idempotent and column-aware: tables without restaurant_id are skipped.
do $$
declare t text;
begin
  foreach t in array array[
    'memberships','suppliers','products','product_aliases',
    'purchase_orders','goods_receipts','invoices','invoice_scans',
    'match_runs','discrepancies','price_history','price_baselines',
    'approval_rules','audit_log','procurement_connections',
    'email_inboxes','supplier_integrations','notifications_outbox'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'restaurant_id'
    ) then
      execute format('alter table %I enable row level security;', t);
      execute format('drop policy if exists %I on %I;', t || '_tenant', t);
      execute format(
        'create policy %I on %I using (restaurant_id = app.current_restaurant_id());',
        t || '_tenant', t
      );
    end if;
  end loop;
end $$;

-- Example join-based policy for a child table without its own restaurant_id.
-- Repeat the pattern for po_lines / gr_lines.
alter table invoice_lines enable row level security;
drop policy if exists invoice_lines_tenant on invoice_lines;
create policy invoice_lines_tenant on invoice_lines
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and i.restaurant_id = app.current_restaurant_id()
    )
  );
