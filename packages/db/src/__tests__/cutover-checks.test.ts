import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCutoverChecks } from '../cutoverChecks';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../rls';
import { testDbUrl } from '../test-env';

/**
 * The post-cutover checks must pass on a DB that went through migrate +
 * provision-rls (exactly what CI does). If a future migration breaks one of the
 * invariants the owner relies on at cutover, this is where it shows first.
 */
const url = testDbUrl();

describe('runCutoverChecks against the migrated + provisioned test DB', () => {
  beforeAll(async () => {
    // Idempotent — same bootstrap the RLS attack suite performs.
    await applyCoreTenantRls(url);
    await applyAuditImmutableRls(url);
    await ensureRlsAppRole(url);
  }, 60_000);

  afterAll(() => undefined);

  it('every non-skipped DB check passes', async () => {
    const results = await runCutoverChecks(url, { checkDefaultPassword: false });
    const failed = results.filter((r) => !r.ok && !r.skipped);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'migrations_applied',
        'rls_complete',
        'app_role',
        'products_same_tenant_fk',
        'invoice_scans_restaurant_not_null',
        'identity_tables_revoked',
        'audit_log_immutable',
      ]),
    );
  }, 60_000);

  it('reports missing migrations when asked for a level beyond the journal', async () => {
    const results = await runCutoverChecks(url, { checkDefaultPassword: false, throughIdx: 18 });
    const mig = results.find((r) => r.name === 'migrations_applied');
    expect(mig?.ok).toBe(true); // a fully migrated DB satisfies any lower level
  });
});
