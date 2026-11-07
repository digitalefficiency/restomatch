import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { formatDoctorReport, redactUrl, runDoctor } from '../doctor';
import { readJournal } from '../migrations';
import { testDbUrl } from '../test-env';

/**
 * `pnpm db:doctor` against the migrated test DB. The deep scenarios (pending
 * migrations, failing preconditions, NOT VALID constraints, a clean post-cutover
 * report) live in upgrade-path.test.ts; this pins the contract of the report.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });

afterAll(async () => {
  await sql.end();
});

describe('db:doctor', () => {
  it('reports the test DB at the latest migration with no journal gaps', async () => {
    const r = await runDoctor(url);
    expect(r.pending).toEqual([]);
    expect(r.applied).toHaveLength(readJournal().entries.length);
    const mig = r.findings.filter((f) => f.section === 'migrations');
    expect(mig.filter((f) => f.status === 'FAIL')).toEqual([]);
    expect(r.findings.find((f) => f.name === 'required extensions')?.status).toBe('PASS');
  });

  it('never writes: the session it uses is read-only', async () => {
    const [before] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    await runDoctor(url);
    const [after] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    expect(after!.n).toBe(before!.n);
    // The doctor runs its probes inside `BEGIN READ ONLY`; prove the mode rejects writes.
    await expect(sql.begin('read only', (tx) => tx`create temp table doctor_probe (x int)`)).rejects.toMatchObject({
      code: '25006',
    });
  });

  it('flags schema drift: an object of an applied migration is missing', async () => {
    // The doctor reads in its own session, so the drop is committed briefly and restored below.
    await sql`drop index if exists invoice_lines_product_idx`;
    try {
      const r = await runDoctor(url);
      const f = r.findings.find((x) => x.name === 'applied migrations intact');
      expect(f?.status).toBe('WARN');
      expect(f?.detail).toContain('invoice_lines_product_idx');
    } finally {
      await sql`create index if not exists invoice_lines_product_idx on invoice_lines using btree (product_id)`;
    }
    const again = await runDoctor(url);
    expect(again.findings.find((x) => x.name === 'applied migrations intact')?.status).toBe('PASS');
  });

  it('FAILs when the app role can write the bank audit or the frozen months (0072)', async () => {
    const before = (await runDoctor(url)).findings.find((f) => f.name === 'read-only tables');
    if (!before) return; // no app role on this DB yet: the app-role section is skipped
    expect(before.status).toBe('PASS');
    for (const t of ['supplier_bank_account_changes', 'leak_month_snapshots', 'leak_month_corrections']) {
      // Committed briefly (the doctor reads in its own session), revoked again below.
      await sql.unsafe(`grant insert on ${t} to restomatch_app`);
      try {
        const f = (await runDoctor(url)).findings.find((x) => x.name === 'read-only tables');
        expect(f?.status, t).toBe('FAIL');
        expect(f?.detail).toContain(t);
      } finally {
        await sql.unsafe(`revoke insert on ${t} from restomatch_app`);
      }
    }
    expect((await runDoctor(url)).findings.find((f) => f.name === 'read-only tables')?.status).toBe('PASS');
  });

  it('FAILs a SECURITY DEFINER function without pg_temp last in its search_path, or with PUBLIC EXECUTE', async () => {
    const ok = (await runDoctor(url)).findings.find((f) => f.name === 'SECURITY DEFINER hardening');
    if (!ok) return; // no app role on this DB yet: the app-role section is skipped
    expect(ok.status).toBe('PASS');
    const fn = 'public.restomatch_bank_account_audit()';
    await sql.unsafe(`alter function ${fn} set search_path = pg_catalog, public`);
    try {
      const f = (await runDoctor(url)).findings.find((x) => x.name === 'SECURITY DEFINER hardening');
      expect(f?.status).toBe('FAIL');
      expect(f?.detail).toMatch(/restomatch_bank_account_audit .*pg_temp must be listed LAST/);
    } finally {
      await sql.unsafe(`alter function ${fn} set search_path = pg_catalog, public, pg_temp`);
    }
    await sql.unsafe(`grant execute on function ${fn} to public`);
    try {
      const f = (await runDoctor(url)).findings.find((x) => x.name === 'SECURITY DEFINER hardening');
      expect(f?.status).toBe('FAIL');
      expect(f?.detail).toMatch(/restomatch_bank_account_audit .*PUBLIC can EXECUTE/);
    } finally {
      await sql.unsafe(`revoke execute on function ${fn} from public`);
    }
    expect((await runDoctor(url)).findings.find((f) => f.name === 'SECURITY DEFINER hardening')?.status).toBe('PASS');
  });

  it('redacts the password and prints a PASS/WARN/FAIL summary', async () => {
    expect(redactUrl('postgres://u:s3cret@h:5432/db')).toBe('postgres://u:***@h:5432/db');
    const r = await runDoctor(url);
    const text = formatDoctorReport(r);
    expect(text).not.toContain(':postgres@');
    expect(text).toMatch(/── migrations/);
    expect(text).toMatch(/\d+ FAIL · \d+ WARN · \d+ PASS/);
  });
});
