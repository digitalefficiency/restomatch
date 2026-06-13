-- ───────────────────────────────────────────────────────────────────────────
-- Per-restaurant Row-Level Security for RestoMatch core tables.
-- Apply during Phase-3 Supabase consolidation (NOT via pnpm db:migrate).
-- Also applied to the local test DB by the RLS attack suite
-- (packages/api/src/__tests__/rls.attack.test.ts) via applyCoreTenantRls().
--
-- Tenancy key: every protected row carries restaurant_id. The app sets the
-- active restaurant per transaction:  SET LOCAL app.current_restaurant_id = '<uuid>';
-- (wired in packages/api/src/trpc.ts memberProcedure via withRestaurant()).
-- Apply on a role that is NOT the table owner / NOT service_role (both bypass RLS).
--
-- The worker connects with a service (RLS-bypassing) role BY DESIGN: cron jobs
-- (baselines, daily expectations, outbox) are inherently cross-tenant. Worker
-- tenant safety relies on the explicit payload-ownership guards in its jobs.
-- ───────────────────────────────────────────────────────────────────────────

create schema if not exists app;

-- Reads the active restaurant from the per-transaction GUC (NULL if unset).
create or replace function app.current_restaurant_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.current_restaurant_id', true), '')::uuid $$;

-- Reads the acting user from the per-transaction GUC (NULL if unset).
create or replace function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.current_user_id', true), '')::uuid $$;

-- The root tenant table keys on `id` rather than `restaurant_id`.
alter table restaurants enable row level security;
drop policy if exists restaurants_tenant on restaurants;
create policy restaurants_tenant on restaurants
  using (id = app.current_restaurant_id());

-- Tenant creation (onboarding.createRestaurant) generates the restaurant uuid
-- in code and sets the GUC to it BEFORE inserting, so the new row satisfies
-- restaurants_tenant (and INSERT..RETURNING can see it). No GUC ⇒ no inserts,
-- anywhere. (Drop the bootstrap policies earlier revisions created.)
drop policy if exists restaurants_create on restaurants;

-- Every table that carries restaurant_id gets the same per-restaurant policy.
-- Idempotent and column-aware: tables without restaurant_id are skipped
-- (children like po_lines/gr_lines/invoice_lines/product_aliases get explicit
-- join-based policies below — keep that list in sync with the schema).
do $$
declare t text;
begin
  foreach t in array array[
    'memberships','suppliers','products',
    'purchase_orders','goods_receipts','invoices','invoice_scans',
    'match_runs','discrepancies','activity_events','price_history',
    'price_baselines','approval_rules','audit_log','procurement_connections',
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
    else
      raise exception 'RLS: table % is listed but has no restaurant_id column', t;
    end if;
  end loop;
end $$;

drop policy if exists memberships_bootstrap on memberships;

-- A user may always list their own memberships. onboarding procedures run as
-- userScopedProcedure (packages/api/src/trpc.ts), which sets only the user GUC.
drop policy if exists memberships_self on memberships;
create policy memberships_self on memberships
  for select using (user_id = app.current_user_id());

-- A user may see the restaurants they belong to (myMemberships joins
-- restaurants for the name before any restaurant GUC exists). The memberships
-- subquery is itself RLS-filtered to the caller's own rows via memberships_self.
drop policy if exists restaurants_member_select on restaurants;
create policy restaurants_member_select on restaurants
  for select using (
    exists (
      select 1 from memberships m
      where m.restaurant_id = restaurants.id
        and m.user_id = app.current_user_id()
    )
  );

-- users is a PII directory, not just credentials: scope reads to the caller's
-- own row. Auth.js manages users/accounts/sessions on the auth (owner/service)
-- connection, which bypasses RLS; the tenant app role gets no other access
-- (see ensureRlsAppRole revokes).
alter table users enable row level security;
drop policy if exists users_self on users;
create policy users_self on users
  for select using (id = app.current_user_id());

-- ── Child tables without their own restaurant_id: join through the parent ──

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

alter table po_lines enable row level security;
drop policy if exists po_lines_tenant on po_lines;
create policy po_lines_tenant on po_lines
  using (
    exists (
      select 1 from purchase_orders po
      where po.id = po_lines.po_id
        and po.restaurant_id = app.current_restaurant_id()
    )
  );

alter table gr_lines enable row level security;
drop policy if exists gr_lines_tenant on gr_lines;
create policy gr_lines_tenant on gr_lines
  using (
    exists (
      select 1 from goods_receipts gr
      where gr.id = gr_lines.gr_id
        and gr.restaurant_id = app.current_restaurant_id()
    )
  );

alter table product_aliases enable row level security;
drop policy if exists product_aliases_tenant on product_aliases;
create policy product_aliases_tenant on product_aliases
  using (
    exists (
      select 1 from products p
      where p.id = product_aliases.product_id
        and p.restaurant_id = app.current_restaurant_id()
    )
  );

-- ── Billing & entitlements: scoped through the restaurant→billing_account link ─
-- billing_accounts / subscriptions / usage_counters have no restaurant_id (a
-- chain shares one account); a member sees them iff the CURRENT restaurant
-- links to that account. The restaurants subquery is itself RLS-filtered to the
-- current restaurant, so this resolves to "the current restaurant's account".
-- Writes happen on the owner/service connection (worker metering, admin, webhooks).

alter table billing_accounts enable row level security;
drop policy if exists billing_accounts_tenant on billing_accounts;
create policy billing_accounts_tenant on billing_accounts
  for select using (
    exists (
      select 1 from restaurants r
      where r.billing_account_id = billing_accounts.id
        and r.id = app.current_restaurant_id()
    )
  );

alter table subscriptions enable row level security;
drop policy if exists subscriptions_tenant on subscriptions;
create policy subscriptions_tenant on subscriptions
  for select using (
    exists (
      select 1 from restaurants r
      where r.billing_account_id = subscriptions.billing_account_id
        and r.id = app.current_restaurant_id()
    )
  );

alter table usage_counters enable row level security;
drop policy if exists usage_counters_tenant on usage_counters;
create policy usage_counters_tenant on usage_counters
  for select using (
    exists (
      select 1 from restaurants r
      where r.billing_account_id = usage_counters.billing_account_id
        and r.id = app.current_restaurant_id()
    )
  );

-- billing_events: webhook log. No member access at all (admin/service only).
alter table billing_events enable row level security;

-- leads: anyone may submit (public landing form), nobody on the tenant role may
-- read (admin reads via the owner connection). RLS-enabled with only an INSERT
-- policy ⇒ SELECT returns zero rows for the app role.
alter table leads enable row level security;
drop policy if exists leads_insert on leads;
create policy leads_insert on leads for insert with check (true);

-- plans is public pricing reference data — intentionally left without RLS so
-- the catalog is readable everywhere.

-- ── Completeness invariant: has restaurant_id ⇒ RLS enabled ────────────────
-- The allowlist above is hand-maintained while the app role's grants include
-- all future tables; this guard turns a forgotten table from a silent
-- cross-tenant exposure into a loud failure at apply time.
do $$
declare missing text;
begin
  select string_agg(c.table_name, ', ') into missing
  from information_schema.columns c
  join pg_class pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and c.column_name = 'restaurant_id'
    and not pc.relrowsecurity;
  if missing is not null then
    raise exception 'RLS: tables with restaurant_id but row security disabled: %', missing;
  end if;
end $$;
