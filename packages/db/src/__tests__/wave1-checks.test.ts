import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { runDoctor } from '../doctor';
import { testDbUrl } from '../test-env';
import { WAVE1_COMPOSITE_FKS, WAVE1_CROSS_TENANT_CHECKS, WAVE1_PRECONDITIONS, wave1CompositeFkFinding } from '../wave1Checks';

/**
 * db:doctor coverage for wave 1 (0048–0057). The test DB has no wave-1 tables,
 * so this proves both halves of the contract: inert without them, and a
 * cross-tenant row is reported once a wave-1-shaped table exists.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

afterAll(async () => {
  await sql.unsafe('drop table if exists credit_notes');
  await sql`delete from suppliers where name like 'wave1-check %'`;
  await sql`delete from restaurants where name like 'wave1-check %'`;
  await sql.end();
});

const ctx = {
  tableExists: async (t: string) => (await sql`select to_regclass(${'public.' + t}) is not null as e`)[0]!.e as boolean,
  columnExists: async (t: string, c: string) =>
    (await sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${t} and column_name = ${c}`).length > 0,
  count: async (q: string) => Number((await sql.unsafe(q))[0]!.count),
};

const integrity = async () => (await runDoctor(url)).findings.find((f) => f.name === 'cross-tenant references')!;

describe('wave-1 doctor checks', () => {
  it('registers a precondition for every wave-1 migration from 0048 to 0058', () => {
    expect(Object.keys(WAVE1_PRECONDITIONS)).toEqual([
      '0048_recovery',
      '0049_monthly_reports',
      '0050_ingest',
      '0051_invoice_source_whatsapp',
      '0052_receiver_languages',
      '0053_ai_assistant',
      '0054_leak_check_sandbox',
      '0055_referrals',
      '0056_recipes_prereqs',
      '0057_recipes',
      '0058_pos_sales',
    ]);
  });

  it('is inert on a database without wave 1: no wave-1 check runs, the report stays clean', async () => {
    const f = await integrity();
    expect(f.status).toBe('PASS');
    expect(f.detail).not.toMatch(/credit_note|recovery_|ingest_/);
    // 0052's guard reads only columns that exist since 0028/0039 → PASS on clean data.
    expect((await WAVE1_PRECONDITIONS['0052_receiver_languages']!(ctx)).status).toBe('PASS');
    expect((await WAVE1_PRECONDITIONS['0048_recovery']!(ctx)).status).toBe('PASS');
    expect((await WAVE1_PRECONDITIONS['0050_ingest']!(ctx)).status).toBe('PASS');
    expect(await wave1CompositeFkFinding(ctx)).toBeNull();
    expect((await runDoctor(url)).findings.find((f) => f.name === 'same-tenant FKs (wave 1)')).toBeUndefined();
  });

  it('reports a wave-1 row that points at another restaurant\'s supplier', async () => {
    const [a] = await sql`insert into restaurants (name) values ('wave1-check A') returning id`;
    const [b] = await sql`insert into restaurants (name) values ('wave1-check B') returning id`;
    const [supB] = await sql`insert into suppliers (restaurant_id, name) values (${b!.id}, 'wave1-check supplier B') returning id`;
    // credit_notes as 0048 creates it (columns the checks read; FKs are single-column there too).
    await sql.unsafe(`create table credit_notes (
      id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
      supplier_id uuid not null, invoice_id uuid, invoice_line_id uuid)`);
    await sql`insert into credit_notes (restaurant_id, supplier_id) values (${a!.id}, ${supB!.id})`;

    const f = await integrity();
    expect(f.status).toBe('WARN');
    expect(f.detail).toContain('credit_note.supplier same tenant: 1');

    await sql.unsafe('drop table credit_notes');
    expect((await integrity()).status).toBe('PASS');
  });

  it('0048/0050 FAIL when a same-named supporting key has other columns (their composite FKs would abort)', async () => {
    // Free the name if the RC already carries the real key (it does once 0048/0050 merge).
    const [had] = await sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'invoices_id_restaurant_id_key'`;
    if (had) await sql.unsafe('alter table invoices drop constraint invoices_id_restaurant_id_key');
    await sql.unsafe('alter table invoices add constraint invoices_id_restaurant_id_key unique (id)');
    try {
      const r48 = await WAVE1_PRECONDITIONS['0048_recovery']!(ctx);
      expect(r48.status).toBe('FAIL');
      expect(r48.detail).toContain('invoices_id_restaurant_id_key exists but is not UNIQUE (id, restaurant_id) on invoices');
      expect((await WAVE1_PRECONDITIONS['0050_ingest']!(ctx)).status).toBe('FAIL');
    } finally {
      await sql.unsafe('alter table invoices drop constraint invoices_id_restaurant_id_key');
    }
    await sql.unsafe('alter table invoices add constraint invoices_id_restaurant_id_key unique (id, restaurant_id)');
    try {
      expect((await WAVE1_PRECONDITIONS['0048_recovery']!(ctx)).status).toBe('PASS');
    } finally {
      if (!had) await sql.unsafe('alter table invoices drop constraint invoices_id_restaurant_id_key');
    }
  });

  it('flags a wave-1 table that lacks its same-tenant composite FKs (an earlier single-column draft)', async () => {
    await sql.unsafe(`create table credit_notes (
      id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
      supplier_id uuid not null, invoice_id uuid, invoice_line_id uuid)`);
    try {
      const f = await wave1CompositeFkFinding(ctx);
      expect(f?.status).toBe('WARN');
      for (const fk of WAVE1_COMPOSITE_FKS.filter((x) => x.table === 'credit_notes')) expect(f?.detail).toContain(fk.name);
      const d = (await runDoctor(url)).findings.find((x) => x.name === 'same-tenant FKs (wave 1)');
      expect(d?.status).toBe('WARN');
    } finally {
      await sql.unsafe('drop table credit_notes');
    }
  });

  it('every cross-tenant check reads the child FK column and the child restaurant_id', () => {
    expect(WAVE1_CROSS_TENANT_CHECKS).toHaveLength(14);
    for (const c of WAVE1_CROSS_TENANT_CHECKS) {
      expect(c.needs).toHaveLength(3);
      expect(c.needs[1]).toEqual([c.needs[0]![0], 'restaurant_id']);
      expect(c.sql).toContain(`c.${c.needs[0]![1]}`);
    }
  });

  it('every column a check needs exists in the wave-1 schema (none is silently skipped)', async () => {
    // invoice_lines has no restaurant_id; every other parent/child column comes from 0048/0050 or the core schema.
    const core = WAVE1_CROSS_TENANT_CHECKS.flatMap((c) => c.needs).filter(([t]) =>
      ['suppliers', 'invoices', 'invoice_lines', 'discrepancies'].includes(t),
    );
    for (const [t, col] of core) {
      const r = await sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = ${t} and column_name = ${col}`;
      expect(r.length, `${t}.${col}`).toBe(1);
    }
  });
});
