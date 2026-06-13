import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * RLS harness utilities.
 *
 * RLS is bypassed by the table owner and by superusers, so exercising the
 * policies requires a separate non-owner role. Production (Supabase) gets the
 * policies during the Phase-3 consolidation; the local test DB gets them via
 * these helpers from the RLS attack suite.
 */

const RLS_APP_ROLE = 'restomatch_app';

function coreTenantRlsSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ and a compiled dist/ both sit one level below the package root.
  return readFileSync(join(here, '..', 'drizzle', 'rls', '0002_core_tenant_rls.sql'), 'utf8');
}

/**
 * Applies 0002_core_tenant_rls.sql (multi-statement) using an owner/admin
 * connection. Idempotent. 0001 is Supabase-only (storage schema) and is NOT
 * applied here.
 */
export async function applyCoreTenantRls(adminConnectionString: string): Promise<void> {
  const client = postgres(adminConnectionString, { max: 1, prepare: false });
  try {
    await client.unsafe(coreTenantRlsSql());
  } finally {
    await client.end();
  }
}

/**
 * Ensures a non-owner login role with full table privileges (but no RLS
 * bypass) exists, and returns a connection string for it. Call AFTER
 * applyCoreTenantRls so the `app` schema exists.
 */
export async function ensureRlsAppRole(adminConnectionString: string): Promise<string> {
  const client = postgres(adminConnectionString, { max: 1, prepare: false });
  try {
    await client.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${RLS_APP_ROLE}') then
          create role ${RLS_APP_ROLE} login password '${RLS_APP_ROLE}';
        end if;
      end $$;
      grant usage on schema public to ${RLS_APP_ROLE};
      grant usage on schema app to ${RLS_APP_ROLE};
      grant select, insert, update, delete on all tables in schema public to ${RLS_APP_ROLE};
      alter default privileges in schema public
        grant select, insert, update, delete on tables to ${RLS_APP_ROLE};
      grant execute on all functions in schema app to ${RLS_APP_ROLE};

      -- Identity tables are a separate trust zone: Auth.js manages them on the
      -- auth (owner/service) connection. The tenant app role keeps only
      -- RLS-scoped SELECT on users (users_self policy) and nothing else —
      -- otherwise a compromised tenant path could read magic-link tokens and
      -- the full user directory.
      revoke all on accounts, sessions, verification_tokens, authenticators
        from ${RLS_APP_ROLE};
      revoke insert, update, delete on users from ${RLS_APP_ROLE};

      -- Billing/catalog tables are written only by the worker, admin, and
      -- webhooks on the owner/service connection. The tenant app role gets
      -- read-only access (plans is public reference data; billing_accounts/
      -- subscriptions/usage_counters are RLS-scoped SELECT). Crucially, plans
      -- has NO RLS, so without this revoke the blanket grant would let a tenant
      -- rewrite plan pricing/limits and self-escalate every tenant on the plan.
      revoke insert, update, delete on
        plans, billing_accounts, subscriptions, usage_counters, billing_events
        from ${RLS_APP_ROLE};
      -- leads: public submit (INSERT policy) only; no edits/reads of others.
      revoke update, delete on leads from ${RLS_APP_ROLE};
    `);
  } finally {
    await client.end();
  }

  const url = new URL(adminConnectionString);
  url.username = RLS_APP_ROLE;
  url.password = RLS_APP_ROLE;
  return url.toString();
}
