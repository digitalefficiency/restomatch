import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../rls';
import { testDbUrl } from '../test-env';

/**
 * 0063: dsr_requests (the DSR audit trail, no restaurant_id) is owner-only. The
 * blanket grant in rls.ts still gives restomatch_app DML on it after
 * provision-rls, so the deny-all RLS policy is what keeps a tenant session from
 * reading subjects' emails or deleting the trail. The owner connection (the dsr
 * router's adminConn) is unaffected.
 */
const url = testDbUrl();
const RLS_APP_ROLE = 'restomatch_app';

describe('0063: dsr_requests is out of the tenant app role reach', () => {
  it('RLS enabled with the deny-all policy', async () => {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql<Array<{ relrowsecurity: boolean; polname: string | null; qual: string | null; with_check: string | null }>>`
        select c.relrowsecurity, p.polname, pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as with_check
          from pg_class c left join pg_policy p on p.polrelid = c.oid
         where c.oid = 'public.dsr_requests'::regclass`;
      expect(rows).toEqual([
        { relrowsecurity: true, polname: 'dsr_requests_no_tenant_access', qual: 'false', with_check: 'false' },
      ]);
    } finally {
      await sql.end();
    }
  });

  it('a tenant session reads, changes and deletes no row, and cannot insert; the owner sees the trail', async () => {
    // provision-rls (re-run): the blanket grant gives restomatch_app DML on dsr_requests again.
    await applyCoreTenantRls(url);
    await applyAuditImmutableRls(url);
    await ensureRlsAppRole(url);
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    const email = `dsr-victim-${process.pid}@example.com`;
    try {
      await sql`insert into dsr_requests (subject_type, subject_email, action, details)
                values ('lead', ${email}, 'erase', ${sql.json({ note: 'other tenant' })})`;
      const asTenant = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
        sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${RLS_APP_ROLE}`);
          await tx`select set_config('app.current_restaurant_id', gen_random_uuid()::text, true)`;
          return fn(tx);
        });
      await asTenant(async (tx) => {
        expect(await tx`select subject_email from dsr_requests where subject_email = ${email}`).toHaveLength(0);
        expect((await tx`update dsr_requests set status = 'x' where subject_email = ${email}`).count).toBe(0);
        expect((await tx`delete from dsr_requests where subject_email = ${email}`).count).toBe(0);
      });
      await expect(
        asTenant((tx) => tx`insert into dsr_requests (subject_type, subject_email, action) values ('lead', 'forged@example.com', 'erase')`),
      ).rejects.toThrow(/row-level security/);
      // The owner connection (RLS bypass) still reads the trail.
      expect(await sql`select subject_email from dsr_requests where subject_email = ${email}`).toHaveLength(1);
    } finally {
      await sql`delete from dsr_requests where subject_email = ${email}`;
      await sql.end();
    }
  }, 60_000);
});
