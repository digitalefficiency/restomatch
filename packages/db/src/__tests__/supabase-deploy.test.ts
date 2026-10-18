import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDoctor } from '../doctor';
import { findJournalGaps, readJournal, runMigrator } from '../migrations';
import { planSupabaseSync, repoRoot, SUPABASE_MIGRATIONS_DIR } from '../supabaseSync';
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

  it('applies every migration file in order as the non-superuser migration role', async (ctx) => {
    if (!canCreate) ctx.skip();
    for (const f of files) {
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
    const [pol] = await sql`select count(*)::int as n from pg_policies where schemaname = 'storage' and policyname like 'invoice_scans%'`;
    expect(pol!.n).toBeGreaterThanOrEqual(6);
    const [unprotected] = await sql`
      select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      where c.relkind = 'r' and not c.relrowsecurity
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'restaurant_id')`;
    expect(unprotected!.n).toBe(0);
  });

  it('db:doctor: no FAIL; the only WARN before go-live is the app role having no LOGIN yet', async (ctx) => {
    if (!canCreate) ctx.skip();
    const r = await runDoctor(migratorUrl.toString());
    expect(r.findings.filter((f) => f.status === 'FAIL')).toEqual([]);
    expect(r.pending).toEqual([]);
    const warns = r.findings.filter((f) => f.status === 'WARN').map((f) => f.name);
    expect(warns).toEqual(['restomatch_app']);
  });

  it('the RLS file is idempotent (re-applying it changes nothing)', async (ctx) => {
    if (!canCreate) ctx.skip();
    const snapshot = async () =>
      (await sql`select string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || coalesce(qual, '') || coalesce(with_check, ''), ',' order by schemaname, tablename, policyname) as p from pg_policies`)[0]!.p;
    const before = await snapshot();
    await applyFile(sql, rlsFile);
    expect(await snapshot()).toBe(before);
  });

  it('after the owner sets the password (ALTER ROLE … LOGIN PASSWORD), the doctor is clean', async (ctx) => {
    if (!canCreate) ctx.skip();
    await sql.unsafe(`alter role restomatch_app with login password 'set-by-the-owner-in-the-sql-editor-0123'`);
    const r = await runDoctor(migratorUrl.toString());
    expect(r.findings.filter((f) => f.status === 'FAIL' || f.status === 'WARN')).toEqual([]);
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
