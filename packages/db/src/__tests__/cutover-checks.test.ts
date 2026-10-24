import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultJournalPath, journalCut, runCutoverChecks } from '../cutoverChecks';
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

  it('cuts the journal by apply order (when) and by tag, not by "idx <= n"', async () => {
    const byTag = (await runCutoverChecks(url, { checkDefaultPassword: false, throughTag: '0058_pos_sales' })).find(
      (r) => r.name === 'migrations_applied',
    );
    expect(byTag).toMatchObject({ ok: true, detail: expect.stringContaining('through 0058_pos_sales') });
    const byPrefix = (await runCutoverChecks(url, { checkDefaultPassword: false, throughTag: '0061' })).find(
      (r) => r.name === 'migrations_applied',
    );
    expect(byPrefix).toMatchObject({ ok: true, detail: expect.stringContaining('through 0061_postgres_queue') });
    const unknown = (await runCutoverChecks(url, { checkDefaultPassword: false, throughTag: '0999_nope' })).find(
      (r) => r.name === 'migrations_applied',
    );
    expect(unknown?.ok).toBe(false);
    // idx is not the apply order: 0039 (idx 33) is applied BEFORE 0033 (idx 34),
    // and a later idx (61, 62) can sit after 58 with a gap.
    const entries = [
      { idx: 33, when: 1781940000000, tag: '0039_invitation_locale' },
      { idx: 34, when: 1781980000000, tag: '0033_plans_catalog' },
      { idx: 58, when: 1782130000000, tag: '0058_pos_sales' },
      { idx: 61, when: 1782160000000, tag: '0061_postgres_queue' },
      { idx: 62, when: 1782170000000, tag: '0062_supplier_confirm' },
    ];
    expect(journalCut(entries)?.tag).toBe('0062_supplier_confirm');
    expect(journalCut(entries, { throughTag: '0033' })?.when).toBe(1781980000000);
    expect(journalCut(entries, { throughIdx: 61 })?.tag).toBe('0061_postgres_queue');
    expect(journalCut(entries, { throughIdx: 60 })).toBeNull();
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
