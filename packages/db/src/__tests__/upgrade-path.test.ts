import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDoctor, type DoctorReport } from '../doctor';
import { readJournal, runMigrator, truncatedMigrationsFolder } from '../migrations';
import { repairAllPreconditions } from '../repairs';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../rls';
import { testDbUrl } from '../test-env';
import { FIXTURE_REFS, seedFixture0018, type Fixture0018 } from '../upgradeFixture';

/**
 * Migration-chain health (client-ready S1):
 *   1. a FRESH database applies 0000 → latest cleanly and a second run is a no-op;
 *   2. a database STOPPED AT 0018 (production's level) holding realistic rows +
 *      every edge case a later guard exists for is diagnosed by the doctor, refuses
 *      to upgrade (atomically — nothing half-applied), is repaired by the shared
 *      repair routines, upgrades to latest, and passes the doctor after
 *      provision-rls; the I5 fix lets a second tenant reuse a platform ref.
 *
 * Runs against a scratch database next to the test DB (<test db>_upgrade),
 * dropped and recreated per scenario. Skips when the role cannot CREATE DATABASE.
 */
const base = new URL(testDbUrl());
const scratchName = `${base.pathname.slice(1)}_upgrade`;
const scratch = new URL(base.toString());
scratch.pathname = `/${scratchName}`;
const scratchUrl = scratch.toString();
const admin = new URL(base.toString());
admin.pathname = '/postgres';

const PROD_LEVEL = 18;
const journal = readJournal().entries;
let canCreate = true;

async function recreateScratch(): Promise<void> {
  const sql = postgres(admin.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql.unsafe(`drop database if exists "${scratchName}" with (force)`);
    await sql.unsafe(`create database "${scratchName}"`);
  } finally {
    await sql.end();
  }
}

async function schemaFingerprint(sql: postgres.Sql): Promise<string> {
  const rows = await sql`
    select string_agg(x, '|' order by x) as f from (
      select 'c:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as x
        from information_schema.columns where table_schema = 'public'
      union all select 'i:' || indexname || ':' || indexdef from pg_indexes where schemaname = 'public'
      union all select 'k:' || conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated from pg_constraint where connamespace = 'public'::regnamespace
      union all select 't:' || tgname from pg_trigger where not tgisinternal
    ) s`;
  return String(rows[0]!.f);
}

const find = (r: DoctorReport, section: string, name: string) =>
  r.findings.find((f) => f.section === section && f.name === name);

beforeAll(async () => {
  try {
    await recreateScratch();
  } catch {
    canCreate = false;
  }
});

afterAll(async () => {
  if (!canCreate) return;
  const sql = postgres(admin.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  await sql.unsafe(`drop database if exists "${scratchName}" with (force)`).catch(() => undefined);
  await sql.end();
});

describe('migration chain: fresh database', () => {
  it('applies 0000 → latest cleanly, and re-running is a no-op', async (ctx) => {
    if (!canCreate) ctx.skip();
    await recreateScratch();
    await runMigrator(scratchUrl);
    const sql = postgres(scratchUrl, { max: 1, prepare: false });
    try {
      const rows = await sql`select created_at from drizzle.__drizzle_migrations order by created_at`;
      expect(rows.map((r) => Number(r.created_at))).toEqual(journal.map((e) => e.when));
      const before = await schemaFingerprint(sql);
      await runMigrator(scratchUrl);
      const again = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      expect(again[0]!.n).toBe(journal.length);
      expect(await schemaFingerprint(sql)).toBe(before);
    } finally {
      await sql.end();
    }
    const report = await runDoctor(scratchUrl);
    expect(report.pending).toEqual([]);
    expect(find(report, 'migrations', 'journal gaps')?.status).toBe('PASS');
    expect(find(report, 'migrations', 'file hashes')?.status).toBe('PASS');
  });
});

describe('migration chain: production-level (0018) database upgrade', () => {
  let fx: Fixture0018;
  let sql: postgres.Sql;

  beforeAll(async () => {
    if (!canCreate) return;
    await recreateScratch();
    await runMigrator(scratchUrl, { folder: truncatedMigrationsFolder(PROD_LEVEL) });
    sql = postgres(scratchUrl, { max: 1, prepare: false, onnotice: () => undefined });
    fx = await seedFixture0018(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('at 0018 the global uniques still block a second tenant from reusing a platform ref (I5)', async (ctx) => {
    if (!canCreate) ctx.skip();
    await expect(
      sql`insert into suppliers (restaurant_id, name, source_platform, external_ref)
          values (${fx.restaurantB}, 'B dup', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.supplierRef})`,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('the doctor lists every pending migration and flags the guarded preconditions', async (ctx) => {
    if (!canCreate) ctx.skip();
    const r = await runDoctor(scratchUrl);
    expect(r.applied).toHaveLength(PROD_LEVEL + 1);
    expect(r.pending).toEqual(journal.filter((e) => e.idx > PROD_LEVEL).map((e) => e.tag));
    const pre = (tag: string) => find(r, 'preconditions', tag);
    expect(pre('0020_invoice_scans_restaurant_not_null')?.status).toBe('FAIL');
    expect(pre('0021_products_supplier_same_tenant')?.status).toBe('FAIL');
    expect(pre('0027_leak_trust')?.status).toBe('FAIL');
    expect(pre('0027_leak_trust')?.detail).toMatch(/VAT 0\.17/);
    expect(pre('0032_integrity_checks')?.status).toBe('WARN');
    expect(pre('0032_integrity_checks')?.detail).toMatch(/gr_lines_qty_received_nonneg=1/);
    for (const tag of ['0019_storage_namespaces', '0022_legal_compliance', '0028_english_receiving', '0029_tenant_scoped_uniques', '0030_fk_indexes', '0031_updated_at_triggers']) {
      expect(pre(tag)?.status, tag).toBe('PASS');
    }
    expect(r.ok).toBe(false);
  });

  it('refuses to upgrade un-repaired data, atomically (nothing from the batch is applied)', async (ctx) => {
    if (!canCreate) ctx.skip();
    await expect(runMigrator(scratchUrl)).rejects.toThrow();
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]!.n).toBe(PROD_LEVEL + 1);
    const ns = await sql`select to_regclass('public.storage_namespaces') is not null as e`;
    expect(ns[0]!.e).toBe(false); // 0019 rolled back with the failed batch
  });

  it('repairs, upgrades to latest, and re-running the migrator is a no-op', async (ctx) => {
    if (!canCreate) ctx.skip();
    const results = await repairAllPreconditions(sql);
    expect(results.every((x) => x.blocking === 0)).toBe(true);
    expect(results.find((x) => x.name.startsWith('0027'))?.changed).toBe(1);
    const pre = await runDoctor(scratchUrl);
    for (const f of pre.findings.filter((x) => x.section === 'preconditions')) {
      expect(f.status, f.name).not.toBe('FAIL');
    }

    await runMigrator(scratchUrl);
    const before = await schemaFingerprint(sql);
    await runMigrator(scratchUrl);
    expect(await schemaFingerprint(sql)).toBe(before);
    const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(rows[0]!.n).toBe(journal.length);

    // Data survived; the kept receipt is the one with lines; 0027 fixed the VAT default.
    const [gr] = await sql`select count(*)::int as n from goods_receipts where po_id = ${fx.poA}`;
    expect(gr!.n).toBe(1);
    const [kept] = await sql`select id from goods_receipts where po_id = ${fx.poA}`;
    expect(kept!.id).toBe(fx.keptReceipt);
    const [vat] = await sql`select vat_rate from restaurants where id = ${fx.restaurantA}`;
    expect(vat!.vat_rate).toBe('0.1800');
    const [inv] = await sql`select count(*)::int as n from invoices where restaurant_id = ${fx.restaurantA}`;
    expect(inv!.n).toBe(2);
  });

  it('I5: after 0029 a second tenant can reuse the platform refs; the same tenant still cannot', async (ctx) => {
    if (!canCreate) ctx.skip();
    const [supB] = await sql`
      insert into suppliers (restaurant_id, name, source_platform, external_ref)
      values (${fx.restaurantB}, 'B same ref', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.supplierRef}) returning id`;
    await sql`
      insert into purchase_orders (restaurant_id, supplier_id, source, source_platform, source_ref)
      values (${fx.restaurantB}, ${supB!.id}, 'platform', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.poRef})`;
    await expect(
      sql`insert into purchase_orders (restaurant_id, supplier_id, source, source_platform, source_ref)
          values (${fx.restaurantA}, ${fx.supplierA}, 'platform', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.poRef})`,
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('updated_at is maintained by trigger unless the UPDATE sets it explicitly', async (ctx) => {
    if (!canCreate) ctx.skip();
    const [before] = await sql`select updated_at from restaurants where id = ${fx.restaurantA}`;
    await sql`update restaurants set name = 'upgrade-A renamed' where id = ${fx.restaurantA}`;
    const [after] = await sql`select updated_at from restaurants where id = ${fx.restaurantA}`;
    expect((after!.updated_at as Date).getTime()).toBeGreaterThan((before!.updated_at as Date).getTime());
    await sql`update restaurants set updated_at = '2020-01-01T00:00:00Z' where id = ${fx.restaurantA}`;
    const [explicit] = await sql`select updated_at from restaurants where id = ${fx.restaurantA}`;
    expect((explicit!.updated_at as Date).toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('0032 left the violated CHECK NOT VALID but enforces it for new rows; the doctor reports it', async (ctx) => {
    if (!canCreate) ctx.skip();
    const [c] = await sql`select convalidated from pg_constraint where conname = 'gr_lines_qty_received_nonneg'`;
    expect(c!.convalidated).toBe(false);
    const [ok] = await sql`select convalidated from pg_constraint where conname = 'restaurants_vat_rate_range'`;
    expect(ok!.convalidated).toBe(true);
    await expect(sql`update restaurants set vat_rate = 1.5 where id = ${fx.restaurantB}`).rejects.toMatchObject({ code: '23514' });
    const r = await runDoctor(scratchUrl);
    expect(find(r, 'constraints', 'all constraints validated')?.status).toBe('WARN');
    expect(find(r, 'constraints', 'all constraints validated')?.detail).toMatch(/gr_lines_qty_received_nonneg \(1 violating/);
  });

  it('after provision-rls + row repair + VALIDATE, the doctor reports no FAIL and no WARN', async (ctx) => {
    if (!canCreate) ctx.skip();
    await sql`update gr_lines set qty_received = 0 where id = ${fx.badGrLine}`;
    await sql`alter table gr_lines validate constraint gr_lines_qty_received_nonneg`;
    await applyCoreTenantRls(scratchUrl);
    await applyAuditImmutableRls(scratchUrl);
    await ensureRlsAppRole(scratchUrl);
    const r = await runDoctor(scratchUrl);
    const bad = r.findings.filter((f) => f.status === 'FAIL' || f.status === 'WARN');
    expect(bad).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
