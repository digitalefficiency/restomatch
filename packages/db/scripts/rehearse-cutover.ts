/**
 * Cutover dress rehearsal (plan v2 T5; extended for client-ready S1) — run against
 * a SCRATCH database (a restored production dump, or an empty local DB):
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_scratch \
 *     pnpm --filter @restomatch/db rehearse-cutover
 *
 * What it proves, in order (the same sequence docs/DB-RUNBOOK.md runs on prod):
 *   1. the journal applies cleanly through 0018 (production's current level)
 *   2. with realistic rows + every guarded edge case seeded (src/upgradeFixture.ts:
 *      NULL-tenant scan, cross-tenant product, duplicate goods receipt, VAT 0.17,
 *      a negative quantity), `db:doctor` flags the 0020/0021/0027 preconditions
 *      and the migrator REFUSES — atomically, nothing from the batch is applied
 *   3. `repair-preconditions` (src/repairs.ts) fixes exactly those rows
 *   4. the migrator completes 0019→latest, and a second run is a no-op
 *   5. provision-rls (0002 + 0003 + restomatch_app) applies
 *   6. verify-cutover checks + `db:doctor` pass (no FAIL); the I5 fix lets a second
 *      tenant reuse a platform ref; VAT 0.17 became 0.18
 *
 * On an EMPTY scratch DB step 1 creates the schema. On a RESTORED DUMP (already at
 * 0018) step 1 is a no-op and the seeded offenders are added on top of real data —
 * pass --skip-seed to rehearse purely against the dump's own rows (then the
 * repairs run on whatever the dump really contains).
 *
 * Refuses non-local URLs unless --i-understand-this-writes is given.
 */
import postgres from 'postgres';
import { formatCheckTable, runCutoverChecks } from '../src/cutoverChecks';
import { formatDoctorReport, runDoctor } from '../src/doctor';
import { runMigrator, truncatedMigrationsFolder } from '../src/migrations';
import { repairAllPreconditions } from '../src/repairs';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../src/rls';
import { FIXTURE_REFS, seedFixture0018, type Fixture0018 } from '../src/upgradeFixture';

const PROD_LEVEL = 18;

function log(msg: string): void {
  console.log(`[rehearse] ${msg}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (scratch DB) is required');
  const local = /localhost|127\.0\.0\.1|_test|scratch|rehears/i.test(url);
  if (!local && !process.argv.includes('--i-understand-this-writes')) {
    throw new Error('[rehearse] refusing to write to a non-local DB — pass --i-understand-this-writes for a restored dump');
  }
  const skipSeed = process.argv.includes('--skip-seed');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

  try {
    log(`1/6 applying journal through ${String(PROD_LEVEL).padStart(4, '0')} (production level)`);
    await runMigrator(url, { folder: truncatedMigrationsFolder(PROD_LEVEL) });

    let fx: Fixture0018 | null = null;
    if (!skipSeed) {
      log('2/6 seeding realistic rows + the guarded edge cases, expecting the doctor to flag them and the migrator to refuse');
      fx = await seedFixture0018(sql);
    } else {
      log("2/6 --skip-seed: rehearsing against the dump's own rows");
    }
    const before = await runDoctor(url);
    const blocking = before.findings.filter((f) => f.section === 'preconditions' && f.status === 'FAIL');
    for (const f of blocking) log(`    doctor FAIL ${f.name}: ${f.detail}`);
    if (blocking.length > 0) {
      try {
        await runMigrator(url);
        throw new Error('[rehearse] the migrator completed although the doctor reported failing preconditions');
      } catch (err) {
        const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
        if (msg.includes('[rehearse]')) throw err;
        log(`    ✔ migrator refused as expected: ${msg.split('\n')[0]}`);
      }
      const [n] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      if (n!.n !== PROD_LEVEL + 1) throw new Error(`[rehearse] the failed batch was NOT atomic: ${n!.n} rows recorded`);
      log('    ✔ batch rolled back atomically (still at 0018)');
    }

    log('3/6 repair-preconditions');
    const repairs = await repairAllPreconditions(sql);
    for (const r of repairs) log(`    ${r.name}: ${r.detail}${r.blocking ? ` — ${r.blocking} BLOCKING row(s)` : ''}`);
    if (repairs.some((r) => r.blocking > 0)) {
      throw new Error('[rehearse] rows remain that a human must attribute (docs/DB-RUNBOOK.md §3) — stop here');
    }

    log('4/6 applying 0019→latest (then once more: must be a no-op)');
    await runMigrator(url);
    const [c1] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    await runMigrator(url);
    const [c2] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    if (c1!.n !== c2!.n) throw new Error('[rehearse] re-running the migrator applied something');

    log('5/6 provisioning RLS (0002 + 0003) + restomatch_app');
    await applyCoreTenantRls(url);
    await applyAuditImmutableRls(url);
    await ensureRlsAppRole(url);

    log('6/6 post-cutover checks');
    const results = await runCutoverChecks(url, { checkDefaultPassword: false });
    console.log(formatCheckTable(results));
    const failed = results.filter((r) => !r.ok && !r.skipped);
    if (failed.length > 0) throw new Error(`[rehearse] ${failed.length} post-cutover check(s) failed`);

    if (fx) {
      const [vat] = await sql`select vat_rate from restaurants where id = ${fx.restaurantA}`;
      if (vat!.vat_rate !== '0.1800') throw new Error(`[rehearse] VAT 0.17 was not corrected (got ${vat!.vat_rate})`);
      await sql`
        insert into suppliers (restaurant_id, name, source_platform, external_ref)
        values (${fx.restaurantB}, 'rehearsal B', ${FIXTURE_REFS.platform}, ${FIXTURE_REFS.supplierRef})`;
      log('    ✔ VAT 0.17 → 0.18; a second tenant can reuse a platform supplier ref (I5)');
    }

    const after = await runDoctor(url);
    console.log(`\n${formatDoctorReport(after)}`);
    if (!after.ok) throw new Error('[rehearse] db:doctor reports FAIL after the cutover');
    console.log('\n[rehearse] ✔ rehearsal complete — the production sequence in docs/DB-RUNBOOK.md is safe to run');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
