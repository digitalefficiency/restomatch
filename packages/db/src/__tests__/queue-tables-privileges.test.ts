import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../rls';
import { testDbUrl } from '../test-env';

/**
 * 0061's owner-only tables (job queue, worker heartbeats, rate-limit counters,
 * ops flags) must stay out of the tenant app role's reach even after
 * provision-rls re-runs its blanket "grant … on all tables" (rlsAppRoleGrantsSql,
 * also emitted into the Supabase RLS migration that runs after 0061).
 */
const url = testDbUrl();
const RLS_APP_ROLE = 'restomatch_app';
const TABLES = ['job_queue', 'worker_heartbeats', 'rate_limit_counters', 'ops_kv'];

describe('0061 tables: restomatch_app has no privilege after provision-rls (re-run)', () => {
  it('no SELECT/INSERT/UPDATE/DELETE on any of the four tables, nor the job id sequence', async () => {
    for (let run = 0; run < 2; run++) {
      await applyCoreTenantRls(url);
      await applyAuditImmutableRls(url);
      await ensureRlsAppRole(url);
    }
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      for (const t of TABLES) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const [row] = await sql<Array<{ ok: boolean }>>`SELECT has_table_privilege(${RLS_APP_ROLE}, ${t}, ${priv}) AS ok`;
          expect(row?.ok, `${RLS_APP_ROLE} ${priv} on ${t}`).toBe(false);
        }
      }
      const [seq] = await sql<Array<{ ok: boolean }>>`SELECT has_sequence_privilege(${RLS_APP_ROLE}, 'job_queue_id_seq', 'USAGE') AS ok`;
      expect(seq?.ok).toBe(false);
    } finally {
      await sql.end();
    }
  }, 60_000);
});
