-- ───────────────────────────────────────────────────────────────────────────
-- audit_log → append-only (immutable, tamper-evident).  Apply AFTER 0002.
--
-- Threat (R-27): the blanket app-role grant + the 0002 ALL policy let the
-- tenant role UPDATE/DELETE its OWN audit rows. A compromised tenant code path
-- could therefore erase/forge its audit trail — failing the integrity duty of
-- Privacy-Law Amendment 13 / Level-3.
--
-- Three layers, defence-in-depth:
--   1. Split the 0002 `audit_log_tenant` ALL policy into SELECT + INSERT only
--      (no UPDATE/DELETE policy ⇒ RLS admits no such rows for the app role).
--   2. REVOKE update,delete on audit_log from restomatch_app (ensureRlsAppRole)
--      ⇒ permission-denied at the privilege layer (the primary gate).
--   3. A BEFORE UPDATE/DELETE trigger that raises for any NON-owner / NON-bypass
--      role ⇒ even if a future grant drifts and re-grants the privilege, the row
--      mutation still fails. RLS-bypassing maintenance roles (the owner used by
--      migrations/retention/DR and the worker service_role, plus ON DELETE
--      CASCADE from restaurants) remain able to purge — that is the trusted
--      maintenance plane, not the tenant plane.
-- ───────────────────────────────────────────────────────────────────────────

create schema if not exists app;

-- 1) Replace the 0002 ALL policy with append-only SELECT + INSERT policies.
alter table audit_log enable row level security;
drop policy if exists audit_log_tenant on audit_log;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select using (restaurant_id = app.current_restaurant_id());

drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (restaurant_id = app.current_restaurant_id());

-- 3) Immutability trigger. Allows mutation only for trusted maintenance roles:
--    superusers, roles flagged BYPASSRLS (service_role / worker), and the table
--    owner (migrations, retention purge, cascade deletes). Everyone else — most
--    importantly the non-owner restomatch_app tenant role — is rejected.
--    Both run as the table OWNER inside cascades (restaurant delete → audit_log), so
--    their search_path is pinned with pg_temp LAST and every catalog, type and cast is
--    schema-qualified: a planted pg_temp.pg_roles / regclass must never resolve here.
create or replace function app.audit_log_is_maintenance_role() returns pg_catalog.bool
  language sql stable
  set search_path = pg_catalog, pg_temp
  as $$
  select exists (
      select 1 from pg_catalog.pg_roles r
      where r.rolname OPERATOR(pg_catalog.=) current_user and (r.rolsuper or r.rolbypassrls)
    )
    or current_user OPERATOR(pg_catalog.=) (
      select pg_catalog.pg_get_userbyid(c.relowner)
      from pg_catalog.pg_class c where c.oid OPERATOR(pg_catalog.=) 'public.audit_log'::pg_catalog.regclass
    )
$$;

create or replace function app.audit_log_immutable() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
  as $$
begin
  if app.audit_log_is_maintenance_role() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'audit_log is append-only: % is not permitted (role %)', tg_op, current_user
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists audit_log_no_update_delete on audit_log;
create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each row execute function app.audit_log_immutable();
