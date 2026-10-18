import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDoctor } from '../doctor';
import { findJournalGaps, readJournal, runMigrator } from '../migrations';
import { planSupabaseSync, repoRoot, SUPABASE_LOCK, SUPABASE_MIGRATIONS_DIR } from '../supabaseSync';
import { testDbUrl } from '../test-env';

/**
 * The Supabase GitHub-integration path, proven on an EMULATED Supabase:
 *   - migrations run as a NON-superuser role with CREATEROLE (Supabase's `postgres`
 *     is not a superuser), owner of the database;
 *   - `storage` (buckets/objects/foldername) is owned by a separate
 *     supabase_storage_admin role; anon/authenticated/service_role exist;
 *   - uuid-ossp is pre-installed in an `extensions` schema, as on Supabase;
 *   - every supabase/migrations file is applied in filename order, one
 *     transaction per file, aborting on the first error (psql -1 ON_ERROR_STOP).
 * Then: drizzle sees the DB as fully migrated, the doctor reports no FAIL, the
 * RLS file is idempotent, and the storage block degrades to a WARNING instead
 * of failing the deploy when the role may not touch storage.objects.
 *
 * Also the staleness gate: supabase/ must match the drizzle journal.
 */
const base = new URL(testDbUrl());
const dbName = `${base.pathname.slice(1)}_supabase`;
const superUrl = new URL(base.toString());
superUrl.pathname = `/${dbName}`;
const adminUrl = new URL(base.toString());
adminUrl.pathname = '/postgres';
const MIGRATOR = 'rm_supabase_postgres';
const migratorUrl = new URL(superUrl.toString());
migratorUrl.username = MIGRATOR;
migratorUrl.password = 'emulated-supabase-postgres';

const migDir = join(repoRoot(), SUPABASE_MIGRATIONS_DIR);
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const rlsFile = files.filter((f) => f.includes('_restomatch_rls_')).at(-1)!;
/** Files main already released (Supabase may have applied them) — main @ b5334f6. */
const RELEASED_ON_MAIN = 37;
const lock = JSON.parse(readFileSync(join(repoRoot(), SUPABASE_LOCK), 'utf8')) as Record<string, string>;
const released = files.slice(0, RELEASED_ON_MAIN);
const appended = files.slice(RELEASED_ON_MAIN);
let canCreate = true;
const notices: string[] = [];

async function applyFile(sql: postgres.Sql, file: string): Promise<void> {
  const body = readFileSync(join(migDir, file), 'utf8');
  await sql.begin((tx) => tx.unsafe(body));
}

beforeAll(async () => {
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${MIGRATOR}') then
          create role ${MIGRATOR} login createrole nosuperuser password '${migratorUrl.password}';
        end if;
        if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      end $$;`);
    await admin.unsafe(`create database "${dbName}" owner ${MIGRATOR}`);
    // Roles are cluster-wide and the local/CI cluster already has restomatch_app (with
    // LOGIN, from provision-rls). Emulate a NEW project: no login, and the migration role
    // may administer it (on Supabase, \`postgres\` creates it). Restored in afterAll.
    await admin.unsafe(`
      do $$ begin
        if exists (select 1 from pg_roles where rolname = 'restomatch_app') then
          alter role restomatch_app nologin;
          grant restomatch_app to ${MIGRATOR} with admin option;
        end if;
      end $$;`);
  } catch {
    canCreate = false;
  } finally {
    await admin.end();
  }
  if (!canCreate) return;
  // Supabase-isms our SQL touches, created by the platform (superuser) side.
  const sup = postgres(superUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sup.unsafe(`
      create schema if not exists extensions;
      create extension if not exists "uuid-ossp" schema extensions;
      create extension if not exists vector;
      create extension if not exists pg_trgm;
      create schema storage authorization supabase_storage_admin;
      create table storage.buckets (
        id text primary key, name text not null, owner uuid, public boolean default false,
        file_size_limit bigint, allowed_mime_types text[],
        created_at timestamptz default now(), updated_at timestamptz default now());
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
        name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
      create function storage.foldername(name text) returns text[] language sql immutable
        as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
      alter table storage.buckets owner to supabase_storage_admin;
      alter table storage.objects owner to supabase_storage_admin;
      alter table storage.objects enable row level security;
      grant usage on schema storage to ${MIGRATOR}, anon, authenticated, service_role;
      grant all on storage.buckets to ${MIGRATOR};
      grant select on storage.objects to ${MIGRATOR};
      -- Supabase lets the dashboard/SQL-editor role manage storage policies.
      grant supabase_storage_admin to ${MIGRATOR};
      -- Supabase's default privileges: every table the migration role creates in
      -- public is granted to the Data API roles (reachable with the publishable key).
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges for role ${MIGRATOR} in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges for role ${MIGRATOR} in schema public grant all on sequences to anon, authenticated, service_role;
    `);
  } finally {
    await sup.end();
  }
});

afterAll(async () => {
  if (!canCreate) return;
  const admin = postgres(adminUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`).catch(() => undefined);
  // Give the shared local/CI app role back its throwaway login (resolveAppRolePassword default).
  await admin.unsafe(`alter role restomatch_app with login password 'restomatch_app'`).catch(() => undefined);
  await admin.end();
});

describe('supabase/ is generated from the drizzle journal', () => {
  it('is up to date (run `pnpm db:supabase-sync` and commit if this fails)', () => {
    const plan = planSupabaseSync();
    expect([...plan.writes.keys()], 'stale files').toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it('is append-only: every locked (released) file is untouched; regenerating is a pure append', () => {
    const plan = planSupabaseSync();
    for (const name of Object.keys(lock)) {
      expect(plan.writes.has(`${SUPABASE_MIGRATIONS_DIR}/${name}`), name).toBe(false);
    }
    expect(Object.keys(lock).sort()).toEqual(files);
    // the first 37 are exactly what main carries (b5334f6): 36 from f98962c + the Data API lockout
    expect(released.at(-2)).toBe('20260620072001_restomatch_rls_21814c44.sql');
    expect(released.at(-1)).toBe('20260620072002_restomatch_rls_2a5eafd1.sql');
    expect(appended.every((f) => f > released.at(-1)!)).toBe(true);
  });

  it('refuses to rewrite or drop a released file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rm-supabase-'));
    try {
      cpSync(join(repoRoot(), 'supabase'), join(tmp, 'supabase'), { recursive: true });
      const victim = join(tmp, SUPABASE_MIGRATIONS_DIR, released.at(-1)!);
      writeFileSync(victim, `${readFileSync(victim, 'utf8')}\n-- edited`);
      expect(() => planSupabaseSync(tmp)).toThrow(/was modified/);
      rmSync(victim);
      expect(() => planSupabaseSync(tmp)).toThrow(/is missing/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('has bootstrap + one file per journal entry + an RLS file, versions strictly increasing', () => {
    const journal = readJournal().entries;
    expect(files[0]).toMatch(/_restomatch_bootstrap\.sql$/);
    for (const e of journal) expect(files.some((f) => f.endsWith(`_${e.tag}.sql`)), e.tag).toBe(true);
    expect(files.at(-1)).toMatch(/_restomatch_rls_[0-9a-f]{8}\.sql$/);
    const versions = files.map((f) => f.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    // No secret in git: the app role is created NOLOGIN without a password.
    expect(readFileSync(join(migDir, rlsFile), 'utf8')).not.toMatch(/^\s*(create|alter)\s+role[^\n]*password/im);
  });
});

describe('git deploy onto an emulated Supabase project', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(migratorUrl.toString(), {
      max: 1,
      prepare: false,
      onnotice: (n) => notices.push(String(n.message)),
    });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('UPGRADE step 1 — main\'s released files apply; walk-ins showcase prefix anon, no plans (what prod has now)', async (ctx) => {
    if (!canCreate) ctx.skip();
    for (const f of released) {
      await applyFile(sql, f).catch((err: unknown) => {
        throw new Error(`${f}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    const r = await runDoctor(migratorUrl.toString());
    expect(r.findings.find((f) => f.name === 'Supabase Data API locked out')?.status).toBe('PASS');
    expect(r.findings.find((f) => f.name === 'tenant storage policies')?.status).toBe('PASS');
    // SB-3: the anon walk-ins showcase policies stay until the server-side upload ships — a known WARN
    expect(r.findings.find((f) => f.name === 'no anonymous storage access')?.status).toBe('WARN');
    const [plans] = await sql`select count(*)::int as n from plans`;
    expect(plans!.n).toBe(0); // F8: no catalog before 0033
  });

  it('UPGRADE step 2 — the appended files apply on top (as Supabase will on the next merge)', async (ctx) => {
    if (!canCreate) ctx.skip();
    expect(appended.length).toBeGreaterThan(0);
    for (const f of appended) {
      await applyFile(sql, f).catch((err: unknown) => {
        throw new Error(`${f}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    const [n] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(n!.n).toBe(readJournal().entries.length);
  });

  it('drizzle sees it as fully migrated: no journal gaps, `db:migrate` is a no-op', async (ctx) => {
    if (!canCreate) ctx.skip();
    expect(await findJournalGaps(migratorUrl.toString())).toEqual([]);
    const fingerprint = async () =>
      (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0]!.n as number;
    const before = await fingerprint();
    await runMigrator(migratorUrl.toString());
    expect(await fingerprint()).toBe(before);
  });

  it('provisions RLS, the NOLOGIN app role, the private bucket and the storage policies', async (ctx) => {
    if (!canCreate) ctx.skip();
    const [role] = await sql`select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'restomatch_app'`;
    expect(role).toMatchObject({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });
    const [bucket] = await sql`select public from storage.buckets where id = 'invoice-scans'`;
    expect(bucket!.public).toBe(false);
    const pols = (await sql`select policyname from pg_policies where schemaname = 'storage' and policyname like 'invoice_scans%' order by 1`).map((r) => r.policyname);
    expect(pols).toEqual([
      'invoice_scans_tenant_delete', 'invoice_scans_tenant_insert', 'invoice_scans_tenant_select', 'invoice_scans_tenant_update',
      'invoice_scans_walkins_insert', 'invoice_scans_walkins_select',
    ]);
    const [lim] = await sql`select file_size_limit, allowed_mime_types from storage.buckets where id = 'invoice-scans'`;
    expect(Number(lim!.file_size_limit)).toBe(11 * 1024 * 1024);
    expect(lim!.allowed_mime_types).toEqual(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
    const [plans] = await sql`select count(*)::int as n from plans`;
    expect(plans!.n).toBe(4);
    const [unprotected] = await sql`
      select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      where c.relkind = 'r' and not c.relrowsecurity
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'restaurant_id')`;
    expect(unprotected!.n).toBe(0);
  });

  it('locks the Supabase Data API roles out of every public table (despite default privileges)', async (ctx) => {
    if (!canCreate) ctx.skip();
    const [exposed] = await sql`
      select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join (values ('anon'), ('authenticated')) r(role)
      where c.relkind = 'r' and (has_table_privilege(r.role, c.oid, 'SELECT') or has_table_privilege(r.role, c.oid, 'INSERT')
        or has_table_privilege(r.role, c.oid, 'UPDATE') or has_table_privilege(r.role, c.oid, 'DELETE'))`;
    expect(exposed!.n).toBe(0);
    // A table created LATER (a future migration) is not re-granted to them either.
    await sql.unsafe('create table public.zz_future_probe (id int)');
    const [p] = await sql`select has_table_privilege('anon', 'public.zz_future_probe', 'SELECT') as a`;
    expect(p!.a).toBe(false);
    await sql.unsafe('drop table public.zz_future_probe');
  });

  it('db:doctor: no FAIL; the only WARNs before go-live are the app role having no LOGIN yet and the walk-ins showcase prefix', async (ctx) => {
    if (!canCreate) ctx.skip();
    const r = await runDoctor(migratorUrl.toString());
    expect(r.findings.filter((f) => f.status === 'FAIL')).toEqual([]);
    expect(r.pending).toEqual([]);
    const warns = r.findings.filter((f) => f.status === 'WARN').map((f) => f.name);
    expect(warns).toEqual(['restomatch_app', 'no anonymous storage access']);
  });

  it('the RLS file is idempotent (re-applying it changes nothing)', async (ctx) => {
    if (!canCreate) ctx.skip();
    const snapshot = async () =>
      (await sql`select string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || coalesce(qual, '') || coalesce(with_check, ''), ',' order by schemaname, tablename, policyname) as p from pg_policies`)[0]!.p;
    const before = await snapshot();
    await applyFile(sql, rlsFile);
    expect(await snapshot()).toBe(before);
  });

  it('after the owner sets the password (ALTER ROLE … LOGIN PASSWORD), the doctor is clean but for the walk-ins WARN', async (ctx) => {
    if (!canCreate) ctx.skip();
    await sql.unsafe(`alter role restomatch_app with login password 'set-by-the-owner-in-the-sql-editor-0123'`);
    const r = await runDoctor(migratorUrl.toString());
    expect(r.findings.filter((f) => f.status === 'FAIL' || f.status === 'WARN').map((f) => f.name)).toEqual(['no anonymous storage access']);
  });

  it('db:doctor FAILs a missing tenant storage policy, a stray anon storage policy and an anon-granted view', async (ctx) => {
    if (!canCreate) ctx.skip();
    const status = async (name: string) => (await runDoctor(migratorUrl.toString())).findings.find((f) => f.name === name)?.status;
    await sql.unsafe('drop policy invoice_scans_tenant_select on storage.objects');
    expect(await status('tenant storage policies')).toBe('FAIL');
    await sql.unsafe(`create policy sneaky_anon on storage.objects for select to anon using (true)`);
    expect(await status('no anonymous storage access')).toBe('FAIL');
    await sql.unsafe('create view public.zz_probe_view as select 1 as x');
    await sql.unsafe('grant select on public.zz_probe_view to anon');
    expect(await status('Supabase Data API locked out')).toBe('FAIL');
    await sql.unsafe('drop view public.zz_probe_view');
    await sql.unsafe('drop policy sneaky_anon on storage.objects');
    await applyFile(sql, rlsFile); // restores the tenant policy (idempotent)
    expect(await status('tenant storage policies')).toBe('PASS');
    expect(await status('no anonymous storage access')).toBe('WARN');
    expect(await status('Supabase Data API locked out')).toBe('PASS');
  });

  it('without rights on storage.objects the RLS file still applies (WARNING, deploy not blocked)', async (ctx) => {
    if (!canCreate) ctx.skip();
    const sup = postgres(superUrl.toString(), { max: 1, prepare: false, onnotice: () => undefined });
    try {
      await sup.unsafe(`revoke supabase_storage_admin from ${MIGRATOR}`);
    } finally {
      await sup.end();
    }
    const fresh = postgres(migratorUrl.toString(), {
      max: 1,
      prepare: false,
      onnotice: (n) => notices.push(String(n.message)),
    });
    try {
      notices.length = 0;
      await applyFile(fresh, rlsFile);
      expect(notices.join('\n')).toMatch(/storage\.objects policies NOT applied/);
    } finally {
      await fresh.end();
    }
  });
});
