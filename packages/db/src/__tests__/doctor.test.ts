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

  it('redacts the password and prints a PASS/WARN/FAIL summary', async () => {
    expect(redactUrl('postgres://u:s3cret@h:5432/db')).toBe('postgres://u:***@h:5432/db');
    const r = await runDoctor(url);
    const text = formatDoctorReport(r);
    expect(text).not.toContain(':postgres@');
    expect(text).toMatch(/── migrations/);
    expect(text).toMatch(/\d+ FAIL · \d+ WARN · \d+ PASS/);
  });
});
