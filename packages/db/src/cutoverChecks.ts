import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Post-cutover verification (plan v2, Wave 0 — docs/GO-LIVE.md §C/§E).
 *
 * One function, reused by `scripts/verify-cutover.ts` (run by the owner against
 * production after the security-stack cutover), by `scripts/rehearse-cutover.ts`
 * (against a restored dump / scratch DB), and by a DB-backed test that keeps the
 * checks themselves honest against the CI database.
 *
 * Every check is read-only. A check that cannot apply (no `storage` schema on
 * vanilla Postgres, no web URL given) reports `skipped`, never `ok: false`.
 */
export interface CheckResult {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface CutoverCheckOptions {
  /** Last journal idx that must be applied (default: the journal's last entry). */
  throughIdx?: number;
  /** Path to drizzle/meta/_journal.json (default: this package's). */
  journalPath?: string;
  /** Try logging in as restomatch_app with the DEFAULT password; fail if it works. */
  checkDefaultPassword?: boolean;
  /** Public web origin to probe (healthz + legal + reset pages). */
  webUrl?: string;
  /** A pg_dump file that must be younger than `maxDumpAgeMs`. */
  dumpPath?: string;
  maxDumpAgeMs?: number;
}

const APP_ROLE = 'restomatch_app';

function journalEntries(journalPath: string): Array<{ idx: number; when: number; tag: string }> {
  const raw = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  return raw.entries;
}

export function defaultJournalPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'drizzle', 'meta', '_journal.json');
}

export async function runCutoverChecks(
  url: string,
  opts: CutoverCheckOptions = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const sql = postgres(url, { max: 1, prepare: false });
  const push = (name: string, ok: boolean, detail: string, skipped = false) =>
    results.push({ name, ok, detail, skipped });

  try {
    // 1. Every journal entry through `throughIdx` is recorded by the drizzle migrator.
    const entries = journalEntries(opts.journalPath ?? defaultJournalPath());
    const through = opts.throughIdx ?? entries[entries.length - 1]!.idx;
    const expected = entries.filter((e) => e.idx <= through);
    const applied = (await sql`
      select created_at from drizzle.__drizzle_migrations
    `) as unknown as Array<{ created_at: string | number }>;
    const appliedWhen = new Set(applied.map((r) => Number(r.created_at)));
    const missing = expected.filter((e) => !appliedWhen.has(e.when));
    push(
      'migrations_applied',
      missing.length === 0,
      missing.length === 0
        ? `all ${expected.length} journal entries through ${String(through).padStart(4, '0')} recorded`
        : `missing: ${missing.map((m) => m.tag).join(', ')}`,
    );

    // 2. RLS completeness — same invariant as check-rls / assertRlsEnabled.
    const unprotected = (await sql`
      select c.table_name
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public' and c.column_name = 'restaurant_id' and not pc.relrowsecurity
      order by c.table_name
    `) as unknown as Array<{ table_name: string }>;
    push(
      'rls_complete',
      unprotected.length === 0,
      unprotected.length === 0
        ? 'every restaurant_id table has RLS enabled'
        : `RLS disabled on: ${unprotected.map((r) => r.table_name).join(', ')}`,
    );

    // 3. The non-owner app role exists and cannot bypass RLS.
    const roles = (await sql`
      select rolname, rolbypassrls, rolcanlogin, rolsuper from pg_roles where rolname = ${APP_ROLE}
    `) as unknown as Array<{ rolbypassrls: boolean; rolcanlogin: boolean; rolsuper: boolean }>;
    const role = roles[0];
    push(
      'app_role',
      !!role && !role.rolbypassrls && role.rolcanlogin && !role.rolsuper,
      role
        ? `bypassrls=${role.rolbypassrls} canlogin=${role.rolcanlogin} super=${role.rolsuper}`
        : `role ${APP_ROLE} does not exist`,
    );

    // 4. The app role must NOT still carry its historical default password (S1).
    if (opts.checkDefaultPassword) {
      const probe = new URL(url);
      probe.username = APP_ROLE;
      probe.password = APP_ROLE;
      const client = postgres(probe.toString(), { max: 1, prepare: false, connect_timeout: 5 });
      let loggedIn = false;
      try {
        await client`select 1`;
        loggedIn = true;
      } catch {
        loggedIn = false;
      } finally {
        await client.end({ timeout: 1 }).catch(() => undefined);
      }
      push(
        'app_role_password_rotated',
        !loggedIn,
        loggedIn
          ? `login as ${APP_ROLE} with the DEFAULT password succeeded — rotate it (APP_ROLE_PASSWORD)`
          : 'default password rejected',
      );
    } else {
      push('app_role_password_rotated', true, 'not probed (local/test DB)', true);
    }

    // 5. Same-tenant composite FK on products.supplier_id (0021).
    const fk = (await sql`
      select 1 from pg_constraint where conname = 'products_supplier_same_tenant_fk'
    `) as unknown as unknown[];
    push('products_same_tenant_fk', fk.length === 1, fk.length === 1 ? 'present' : 'missing (0021)');

    // 6. invoice_scans.restaurant_id NOT NULL (0020).
    const col = (await sql`
      select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice_scans' and column_name = 'restaurant_id'
    `) as unknown as Array<{ is_nullable: string }>;
    push(
      'invoice_scans_restaurant_not_null',
      col[0]?.is_nullable === 'NO',
      col[0] ? `is_nullable=${col[0].is_nullable}` : 'column missing',
    );

    // 7. Credential tables are invisible to the app role (0026 / ensureRlsAppRole).
    if (role) {
      const priv = (await sql`
        select
          coalesce(has_table_privilege(${APP_ROLE}, 'public.user_credentials', 'SELECT'), false) as sel,
          coalesce(has_table_privilege(${APP_ROLE}, 'public.password_reset_tokens', 'SELECT'), false) as prt,
          coalesce(has_table_privilege(${APP_ROLE}, 'public.user_recovery_codes', 'SELECT'), false) as rc
      `) as unknown as Array<{ sel: boolean; prt: boolean; rc: boolean }>;
      const p = priv[0]!;
      push(
        'identity_tables_revoked',
        !p.sel && !p.prt && !p.rc,
        `user_credentials=${p.sel} password_reset_tokens=${p.prt} user_recovery_codes=${p.rc} (must all be false)`,
      );
    } else {
      push('identity_tables_revoked', false, 'app role missing');
    }

    // 8. audit_log immutability trigger (rls/0003).
    const trg = (await sql`
      select 1 from pg_trigger where tgname = 'audit_log_no_update_delete' and not tgisinternal
    `) as unknown as unknown[];
    push('audit_log_immutable', trg.length === 1, trg.length === 1 ? 'trigger present' : 'trigger missing (rls/0003)');

    // 9/10. Supabase storage: bucket private + object policies (skipped on vanilla PG).
    const storage = (await sql`
      select exists (select 1 from information_schema.schemata where schema_name = 'storage') as e
    `) as unknown as Array<{ e: boolean }>;
    if (storage[0]?.e) {
      const bucket = (await sql`
        select public from storage.buckets where id = 'invoice-scans'
      `) as unknown as Array<{ public: boolean }>;
      push(
        'storage_bucket_private',
        bucket.length === 1 && bucket[0]!.public === false,
        bucket.length === 1 ? `public=${bucket[0]!.public}` : 'bucket invoice-scans missing',
      );
      const pol = (await sql`
        select count(*)::int as n from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname like 'invoice_scans%'
      `) as unknown as Array<{ n: number }>;
      push('storage_object_policies', (pol[0]?.n ?? 0) >= 4, `${pol[0]?.n ?? 0} invoice_scans* policies on storage.objects`);
    } else {
      push('storage_bucket_private', true, 'no storage schema (not Supabase)', true);
      push('storage_object_policies', true, 'no storage schema (not Supabase)', true);
    }
  } finally {
    await sql.end();
  }

  // 11. Public web surface (legal + reset must be reachable signed-out; R7).
  if (opts.webUrl) {
    const base = opts.webUrl.replace(/\/+$/, '');
    for (const path of ['/api/healthz', '/privacy', '/terms', '/cookies', '/reset']) {
      try {
        const res = await fetch(`${base}${path}`, { redirect: 'manual' });
        push(`web ${path}`, res.status === 200, `HTTP ${res.status}`);
      } catch (err) {
        push(`web ${path}`, false, err instanceof Error ? err.message : String(err));
      }
    }
  } else {
    push('web_routes', true, 'no --web-url given', true);
  }

  // 12. A fresh backup exists before anyone touches production.
  if (opts.dumpPath) {
    try {
      const age = Date.now() - statSync(opts.dumpPath).mtimeMs;
      const max = opts.maxDumpAgeMs ?? 2 * 60 * 60 * 1000;
      push('backup_fresh', age <= max, `${opts.dumpPath} is ${Math.round(age / 60_000)} min old (max ${Math.round(max / 60_000)})`);
    } catch (err) {
      push('backup_fresh', false, err instanceof Error ? err.message : String(err));
    }
  } else {
    push('backup_fresh', true, 'no --dump given', true);
  }

  return results;
}

export function formatCheckTable(results: CheckResult[]): string {
  const w = Math.max(...results.map((r) => r.name.length));
  return results
    .map((r) => `${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`)
    .join('\n');
}
