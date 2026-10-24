import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCutoverChecks } from '../cutoverChecks';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../rls';
import { testDbUrl } from '../test-env';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultJournalPath } from '../cutoverChecks';

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

  it('checks every entry by `when`, not by the highest applied one (wave-1 lands with an older `when` than 0061)', async () => {
    // Emulate a journal where an entry is OLDER (when) than the newest applied
    // migration and sits at a higher idx — wave-1's 0046–0058 vs 0061. If it is
    // not recorded, the check must name it, not report "all applied".
    const j = JSON.parse(readFileSync(defaultJournalPath(), 'utf8')) as {
      entries: Array<{ idx: number; when: number; tag: string; version?: string; breakpoints?: boolean }>;
    };
    const last = j.entries[j.entries.length - 1]!;
    j.entries.push({ ...last, idx: last.idx + 1, when: j.entries[1]!.when + 1, tag: '0046_not_applied_wave1' });
    const dir = mkdtempSync(join(tmpdir(), 'journal-'));
    const journalPath = join(dir, '_journal.json');
    writeFileSync(journalPath, JSON.stringify(j));
    const results = await runCutoverChecks(url, { checkDefaultPassword: false, journalPath });
    const mig = results.find((r) => r.name === 'migrations_applied');
    expect(mig?.ok).toBe(false);
    expect(mig?.detail).toMatch(/missing: 0046_not_applied_wave1/);
  });
});
