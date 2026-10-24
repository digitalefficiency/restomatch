import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { runDoctor } from '../doctor';
import { testDbUrl } from '../test-env';
import { WAVE1_COMPOSITE_FKS, WAVE1_CROSS_TENANT_CHECKS, WAVE1_PRECONDITIONS, wave1CompositeFkFinding } from '../wave1Checks';

/**
 * db:doctor coverage for wave 1 (0048–0057): inert on clean data, and a
 * cross-tenant row is reported once a wave-1 table holds one. Works with or
 * without the real 0048 applied (a scratch credit_notes is used when absent).
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

// True once the real 0048 is applied on the test DB (wave 1 merged): then the
// scratch table is not created/dropped — the real one is used instead.
let realCreditNotes = false;

afterAll(async () => {
  if (!realCreditNotes) await sql.unsafe('drop table if exists credit_notes');
  await sql`delete from suppliers where name like 'wave1-check %'`;
  await sql`delete from restaurants where name like 'wave1-check %'`;
  await sql.end();
});

type Q = Pick<postgres.Sql, 'unsafe'>;
/** The doctor's check context on a connection (or an open transaction). */
const ctxOf = (q: Q) => ({
  tableExists: async (t: string) => (await q.unsafe('select to_regclass($1) is not null as e', ['public.' + t]))[0]!.e as boolean,
  columnExists: async (t: string, c: string) =>
    (
      await q.unsafe(
        "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
        [t, c],
      )
    ).length > 0,
  count: async (query: string) => Number((await q.unsafe(query))[0]!.count),
});
const ctx = ctxOf(sql);

/** Run `fn` in a transaction that is always rolled back (DDL included). */
const ROLLBACK = new Error('wave1-checks: rollback');
async function inRolledBackTx(fn: (tx: Q) => Promise<void>): Promise<void> {
  await sql
    .begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    })
    .catch((e: unknown) => {
      if (e !== ROLLBACK) throw e;
    });
}

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
    const fkCheck = (await runDoctor(url)).findings.find((f) => f.name === 'same-tenant FKs (wave 1)');
    if (await ctx.tableExists('credit_notes')) {
      // Integrated tree (the real 0048/0050 applied): the composite-FK check runs
      // and reports every one of them in place — never a false WARN.
      expect(await wave1CompositeFkFinding(ctx)).toEqual({
        status: 'PASS',
        detail: `${WAVE1_COMPOSITE_FKS.length} same-tenant composite FKs in place`,
      });
      expect(fkCheck?.status).toBe('PASS');
    } else {
      expect(await wave1CompositeFkFinding(ctx)).toBeNull();
      expect(fkCheck).toBeUndefined();
    }
  });

  it('reports a wave-1 row that points at another restaurant\'s supplier', async () => {
    const [a] = await sql`insert into restaurants (name) values ('wave1-check A') returning id`;
    const [b] = await sql`insert into restaurants (name) values ('wave1-check B') returning id`;
    const [supB] = await sql`insert into suppliers (restaurant_id, name) values (${b!.id}, 'wave1-check supplier B') returning id`;
    realCreditNotes = (await sql`select to_regclass('public.credit_notes') is not null as ok`)[0]!.ok as boolean;
    if (realCreditNotes) {
      // The real 0048 refuses this row (composite same-tenant FK) — plant it the
      // way corrupt data would arrive (FK triggers off for this session only), so
      // the doctor check is still proven to catch it.
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`insert into credit_notes (restaurant_id, supplier_id, amount_agorot, issued_on) values (${a!.id}, ${supB!.id}, 100, '2026-10-01')`;
      });
    } else {
      // credit_notes as 0048 creates it (the columns the checks read).
      await sql.unsafe(`create table credit_notes (
        id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
        supplier_id uuid not null, invoice_id uuid, invoice_line_id uuid)`);
      await sql`insert into credit_notes (restaurant_id, supplier_id) values (${a!.id}, ${supB!.id})`;
    }

    const f = await integrity();
    expect(f.status).toBe('WARN');
    expect(f.detail).toContain('credit_note.supplier same tenant: 1');

    if (realCreditNotes) await sql`delete from credit_notes where restaurant_id = ${a!.id}`;
    else await sql.unsafe('drop table credit_notes');
    expect((await integrity()).status).toBe('PASS');
  });

  it('0048/0050 FAIL when a same-named supporting key has other columns (their composite FKs would abort)', async () => {
    // In a rolled-back transaction: once 0048/0050 are applied the real key exists
    // and their composite FKs depend on it, so freeing the name needs CASCADE —
    // the rollback restores the key and every FK exactly as they were.
    await inRolledBackTx(async (tx) => {
      const c = ctxOf(tx);
      await tx.unsafe('alter table invoices drop constraint if exists invoices_id_restaurant_id_key cascade');
      await tx.unsafe('alter table invoices add constraint invoices_id_restaurant_id_key unique (id)');
      const r48 = await WAVE1_PRECONDITIONS['0048_recovery']!(c);
      expect(r48.status).toBe('FAIL');
      expect(r48.detail).toContain('invoices_id_restaurant_id_key exists but is not UNIQUE (id, restaurant_id) on invoices');
      expect((await WAVE1_PRECONDITIONS['0050_ingest']!(c)).status).toBe('FAIL');
      await tx.unsafe('alter table invoices drop constraint invoices_id_restaurant_id_key');
      await tx.unsafe('alter table invoices add constraint invoices_id_restaurant_id_key unique (id, restaurant_id)');
      expect((await WAVE1_PRECONDITIONS['0048_recovery']!(c)).status).toBe('PASS');
    });
  });

  it('flags a wave-1 table that lacks its same-tenant composite FKs (an earlier single-column draft)', async () => {
    // With the real 0048 applied, turn credit_notes into the earlier draft by
    // dropping its composite FKs (definitions saved, re-added in `finally`);
    // without it, a scratch table of that draft's shape is used.
    const real = await ctx.tableExists('credit_notes');
    const saved: Array<{ name: string; def: string }> = [];
    if (real) {
      for (const fk of WAVE1_COMPOSITE_FKS.filter((x) => x.table === 'credit_notes')) {
        const [r] = await sql`select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = ${fk.name} and conrelid = 'public.credit_notes'::regclass`;
        if (!r) continue;
        saved.push({ name: fk.name, def: r.def as string });
        await sql.unsafe(`alter table credit_notes drop constraint ${fk.name}`);
      }
      expect(saved).toHaveLength(WAVE1_COMPOSITE_FKS.filter((x) => x.table === 'credit_notes').length);
    } else {
      await sql.unsafe(`create table credit_notes (
        id uuid primary key default gen_random_uuid(), restaurant_id uuid not null,
        supplier_id uuid not null, invoice_id uuid, invoice_line_id uuid)`);
    }
    try {
      const f = await wave1CompositeFkFinding(ctx);
      expect(f?.status).toBe('WARN');
      for (const fk of WAVE1_COMPOSITE_FKS.filter((x) => x.table === 'credit_notes')) expect(f?.detail).toContain(fk.name);
      const d = (await runDoctor(url)).findings.find((x) => x.name === 'same-tenant FKs (wave 1)');
      expect(d?.status).toBe('WARN');
    } finally {
      if (real) for (const s of saved) await sql.unsafe(`alter table credit_notes add constraint ${s.name} ${s.def}`);
      else await sql.unsafe('drop table credit_notes');
    }
    if (real) expect((await wave1CompositeFkFinding(ctx))?.status).toBe('PASS');
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
