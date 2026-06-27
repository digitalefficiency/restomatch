import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  applyCoreTenantRls,
  applyStorageRls,
  createDb,
  ensureRlsAppRole,
  invoiceScans,
  sql,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * STORAGE CROSS-TENANT ATTACK SUITE (PR1 / Epic A) — the storage-layer backstop.
 *
 * Proves that one tenant cannot reach another tenant's invoice scans by ANY
 * vector: reading/guessing storage.objects, inserting/updating/deleting under a
 * foreign prefix, the invoice_scans mapping table, or the tenant-gated resolve
 * query. Mirrors the rls.attack.test harness: connect as `restomatch_app` (a
 * non-owner role that CANNOT bypass RLS) and exercise the real policies.
 *
 * storage.objects / storage.buckets / storage.foldername are Supabase-specific
 * and absent from vanilla Postgres, so beforeAll creates a MINIMAL SHIM (the
 * same column + function semantics Supabase uses) and then applies the REAL
 * policy SQL (drizzle/rls/0001) on top — so the policy logic is genuinely
 * exercised in CI. Vectors that require the Supabase network (the actual
 * createSignedUrl, the actual scans.upload byte upload) are asserted at the
 * layer that BACKS them (the SELECT/WITH-CHECK policies, the membership gate),
 * with comments on what must additionally be verified against real Supabase.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const RLS_APP_ROLE = 'restomatch_app';
const BUCKET = 'invoice-scans';

const ownerDb = createDb(TEST_DB_URL);

let appDb: Database;
let A: Tenant;
let B: Tenant;

function aPath() {
  return `${A.restaurantId}/scanA.pdf`;
}
function bPath() {
  return `${B.restaurantId}/scanB.pdf`;
}

/**
 * Minimal vanilla-Postgres shim of the Supabase storage schema. Mirrors the
 * column shape the policies touch and the EXACT semantics of
 * storage.foldername(name) (split on '/', drop the final file segment). Grants
 * the non-owner app role table privileges so RLS — not a missing GRANT — is what
 * gates it. Idempotent.
 */
async function applyStorageShim(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1, prepare: false });
  try {
    await client.unsafe(`
      create schema if not exists storage;

      create table if not exists storage.buckets (
        id text primary key,
        name text,
        public boolean not null default true
      );
      insert into storage.buckets (id, name, public)
        values ('${BUCKET}', '${BUCKET}', true)
        on conflict (id) do update set public = true;

      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null,
        name text not null,
        owner uuid,
        created_at timestamptz not null default now()
      );

      create or replace function storage.foldername(name text) returns text[]
        language sql immutable as $func$
          select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
        $func$;

      grant usage on schema storage to ${RLS_APP_ROLE};
      grant select on storage.buckets to ${RLS_APP_ROLE};
      grant select, insert, update, delete on storage.objects to ${RLS_APP_ROLE};
      grant execute on function storage.foldername(text) to ${RLS_APP_ROLE};
    `);
  } finally {
    await client.end();
  }
}

async function seedStorageObject(name: string): Promise<void> {
  await ownerDb.execute(
    sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${name})`,
  );
}

async function clearStorageObjects(): Promise<void> {
  await ownerDb.execute(sql`delete from storage.objects`);
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL); // app schema + invoice_scans table RLS
  const appUrl = await ensureRlsAppRole(TEST_DB_URL); // creates restomatch_app
  await applyStorageShim(TEST_DB_URL); // storage.* shim + grants to the app role
  await applyStorageRls(TEST_DB_URL); // applies 0001: bucket private + prefix policies
  appDb = createDb(appUrl);

  await resetDb(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');

  // Seed storage objects (owner bypasses RLS) under each tenant's prefix + a
  // shared anonymous showcase object.
  await clearStorageObjects();
  await seedStorageObject(aPath());
  await seedStorageObject(bPath());
  await seedStorageObject('walk-ins/demo.pdf');

  // Seed the invoice_scans mapping rows (tenant-scoped; restaurant_id NOT NULL).
  await ownerDb.insert(invoiceScans).values([
    { invoiceId: A.invoiceId, restaurantId: A.restaurantId, storagePath: aPath(), mimeType: 'application/pdf' },
    { invoiceId: B.invoiceId, restaurantId: B.restaurantId, storagePath: bPath(), mimeType: 'application/pdf' },
  ]);
});

afterAll(async () => {
  await clearStorageObjects();
  await ownerDb.delete(invoiceScans);
  await resetDb(ownerDb);
});

describe('harness sanity', () => {
  it('the app role genuinely cannot bypass RLS', async () => {
    const rows = (await appDb.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    )) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it('the invoice-scans bucket is PRIVATE after applying storage RLS (A.1)', async () => {
    const rows = (await ownerDb.execute(
      sql`select public from storage.buckets where id = ${BUCKET}`,
    )) as unknown as Array<{ public: boolean }>;
    expect(rows[0]?.public).toBe(false);
  });
});

describe('storage.objects per-restaurant isolation (A.2)', () => {
  async function namesVisibleTo(restaurantId: string): Promise<string[]> {
    const rows = (await withRestaurant(appDb, restaurantId, (tx) =>
      tx.execute(sql`select name from storage.objects where bucket_id = ${BUCKET} order by name`),
    )) as unknown as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  it('GUC=B can SELECT its own object but NEVER tenant A\'s', async () => {
    const names = await namesVisibleTo(B.restaurantId);
    expect(names).toContain(bPath());
    expect(names).not.toContain(aPath());
    // walk-ins/ is the shared anonymous showcase space (intentionally visible).
    expect(names.every((n) => !n.startsWith(`${A.restaurantId}/`))).toBe(true);
  });

  it('guessed-path probe: GUC=B selecting A\'s exact object name returns 0 rows', async () => {
    const rows = (await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.execute(sql`select name from storage.objects where name = ${aPath()}`),
    )) as unknown as Array<{ name: string }>;
    expect(rows).toHaveLength(0);
  });

  it('a connection with NO restaurant GUC sees zero tenant objects', async () => {
    const rows = (await appDb.execute(
      sql`select name from storage.objects where bucket_id = ${BUCKET} and (storage.foldername(name))[1] <> 'walk-ins'`,
    )) as unknown as Array<{ name: string }>;
    expect(rows).toHaveLength(0);
  });

  it('GUC=B cannot INSERT an object under tenant A\'s prefix (WITH CHECK)', async () => {
    await expect(
      withRestaurant(appDb, B.restaurantId, (tx) =>
        tx.execute(
          sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${`${A.restaurantId}/evil.pdf`})`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('GUC=B CAN INSERT under its own prefix (positive control)', async () => {
    const ownName = `${B.restaurantId}/own-${Date.now()}.pdf`;
    await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.execute(sql`insert into storage.objects (bucket_id, name) values (${BUCKET}, ${ownName})`),
    );
    const rows = (await ownerDb.execute(
      sql`select name from storage.objects where name = ${ownName}`,
    )) as unknown as Array<{ name: string }>;
    expect(rows).toHaveLength(1);
    await ownerDb.execute(sql`delete from storage.objects where name = ${ownName}`);
  });

  it('GUC=B cannot UPDATE tenant A\'s object (0 rows; USING hides it)', async () => {
    const updated = (await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.execute(
        sql`update storage.objects set name = ${`${B.restaurantId}/stolen.pdf`} where name = ${aPath()} returning id`,
      ),
    )) as unknown as Array<{ id: string }>;
    expect(updated).toHaveLength(0);
    // A's object is untouched.
    const still = (await ownerDb.execute(
      sql`select name from storage.objects where name = ${aPath()}`,
    )) as unknown as Array<{ name: string }>;
    expect(still).toHaveLength(1);
  });

  it('GUC=B cannot DELETE tenant A\'s object (0 rows; USING hides it)', async () => {
    const deleted = (await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.execute(sql`delete from storage.objects where name = ${aPath()} returning id`),
    )) as unknown as Array<{ id: string }>;
    expect(deleted).toHaveLength(0);
    const still = (await ownerDb.execute(
      sql`select name from storage.objects where name = ${aPath()}`,
    )) as unknown as Array<{ name: string }>;
    expect(still).toHaveLength(1);
  });

  // NOTE: "tenant B cannot SIGN a URL for A's path" is enforced by Supabase
  // checking the SELECT policy above before issuing a signed URL. The SELECT
  // denial (visible-set + guessed-path tests) is the in-CI proxy; the actual
  // createSignedUrl rejection must be verified against real Supabase Storage.
});

describe('invoice_scans mapping table + resolve gate (A.3 / A.7)', () => {
  it('GUC=B cannot SELECT tenant A\'s invoice_scans row (table RLS)', async () => {
    const rows = await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.select({ rid: invoiceScans.restaurantId }).from(invoiceScans),
    );
    expect(rows.every((r) => r.rid === B.restaurantId)).toBe(true);
    expect(rows.some((r) => r.rid === A.restaurantId)).toBe(false);
  });

  it('resolveUploadedScan gate: B querying A\'s invoiceId returns nothing', async () => {
    // Mirrors apps/web/lib/supabase/server.ts resolveUploadedScan, which uses
    // the service role (RLS bypass — modelled here by ownerDb) but applies the
    // mandatory .eq(invoice_id).eq(restaurant_id) tenant gate. B asking for A's
    // invoiceId under B's restaurant id resolves to zero rows ⇒ returns null.
    const rows = (await ownerDb.execute(
      sql`select id from invoice_scans where invoice_id = ${A.invoiceId} and restaurant_id = ${B.restaurantId}`,
    )) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(0);
  });
});

describe('scans.upload server authority (A.3)', () => {
  it('rejects a caller with no active restaurant membership (FORBIDDEN)', async () => {
    // memberProcedure short-circuits BEFORE any Supabase call when the session
    // carries no restaurant. The full byte-upload + service-role insert path
    // must be verified against real Supabase (network-bound, not in CI).
    const session: Session = { userId: A.ownerUserId, restaurantId: null, role: null };
    const ctx: AppContext = { db: appDb, session };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.scans.upload({ contentBase64: 'AAAA', mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
