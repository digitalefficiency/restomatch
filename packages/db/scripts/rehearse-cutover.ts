/**
 * Cutover dress rehearsal (plan v2, Wave 0 / T5) — run against a SCRATCH database
 * (a restored production dump, or an empty local DB):
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_scratch \
 *     pnpm --filter @restomatch/db rehearse-cutover
 *
 * What it proves, in order:
 *   1. the journal applies cleanly through 0018 (production's current level)
 *   2. with a NULL-tenant invoice scan + a cross-tenant product seeded, running the
 *      migrator FAILS LOUDLY at 0020 (guard) — so the owner sees the real message
 *   3. after the runbook repairs (delete the unscoped walk-in scan; re-point the
 *      cross-tenant product) the migrator completes 0019→0026
 *   4. provision-rls (0002 + 0003 + restomatch_app) applies
 *   5. every post-cutover check in cutoverChecks.ts passes
 *
 * On an EMPTY scratch DB step 1 creates the schema. On a RESTORED DUMP (already at
 * 0018) step 1 is a no-op and the seeded offenders are added on top of real data —
 * pass --skip-seed to rehearse purely against the dump's own rows.
 *
 * Refuses non-local URLs unless --i-understand-this-writes is given.
 */
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { formatCheckTable, runCutoverChecks } from '../src/cutoverChecks';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../src/rls';

const PROD_LEVEL = 18;
const here = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(here, '..', 'drizzle');

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function journal(): { version: string; dialect: string; entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));
}

/** A temp migrations folder containing only journal entries <= idx. */
function truncatedMigrationsFolder(throughIdx: number): string {
  const j = journal();
  const dir = mkdtempSync(join(tmpdir(), 'restomatch-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const entries = j.entries.filter((e) => e.idx <= throughIdx);
  for (const e of entries) copyFileSync(join(DRIZZLE_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...j, entries }, null, 2));
  return dir;
}

async function runMigrator(url: string, folder: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await sql.unsafe(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);
    await migrate(drizzle(sql), { migrationsFolder: folder });
  } finally {
    await sql.end();
  }
}

async function expectMigratorFailure(url: string, needle: RegExp, label: string): Promise<void> {
  try {
    await runMigrator(url, DRIZZLE_DIR);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? '')}` : String(err);
    if (needle.test(msg)) {
      console.log(`[rehearse] ✔ ${label} fired as expected: ${msg.split('\n')[0]}`);
      return;
    }
    throw new Error(`[rehearse] ${label}: migrator failed for an UNEXPECTED reason: ${msg}`);
  }
  throw new Error(`[rehearse] ${label}: the migrator completed but the guard should have fired`);
}

async function seedOffenders(url: string): Promise<{ productId: string; scanId: string }> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const [a] = await sql`insert into restaurants (name, business_id) values ('rehearsal-A', '000000001') returning id`;
    const [b] = await sql`insert into restaurants (name, business_id) values ('rehearsal-B', '000000002') returning id`;
    const [supA] = await sql`insert into suppliers (restaurant_id, name) values (${a!.id}, 'rehearsal supplier A') returning id`;
    // Cross-tenant offender: a product in B pointing at A's supplier (legal before 0021).
    const [prod] = await sql`
      insert into products (restaurant_id, canonical_name, supplier_id)
      values (${b!.id}, 'rehearsal cross-tenant product', ${supA!.id}) returning id`;
    // Unscoped scan: a walk-in showcase row with NULL restaurant_id (legal before 0020).
    const [inv] = await sql`
      insert into invoices (restaurant_id, status, source) values (${a!.id}, 'ocr_pending', 'photo') returning id`;
    const [scan] = await sql`
      insert into invoice_scans (invoice_id, restaurant_id, storage_path, mime_type)
      values (${inv!.id}, null, 'walk-ins/rehearsal.pdf', 'application/pdf') returning id`;
    return { productId: prod!.id as string, scanId: scan!.id as string };
  } finally {
    await sql.end();
  }
}

async function repairUnscopedScans(url: string): Promise<number> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    // Runbook case A (docs/PR1-storage-isolation-APPLY.md §2b): walk-in demo rows are
    // not tenant data — delete the mapping rows. Real tenant scans must be moved by
    // a human (case B); the rehearsal only ever seeds walk-ins.
    const rows = await sql`delete from invoice_scans where restaurant_id is null and storage_path like 'walk-ins/%' returning id`;
    const left = await sql`select count(*)::int as n from invoice_scans where restaurant_id is null`;
    if ((left[0]?.n ?? 0) > 0) {
      throw new Error(`[rehearse] ${left[0]!.n} unscoped invoice_scans row(s) are NOT walk-ins — a human must attribute them (runbook case B) before 0020 can apply`);
    }
    return rows.length;
  } finally {
    await sql.end();
  }
}

async function repairCrossTenantProducts(url: string): Promise<number> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    // Runbook: backfill-product-supplier.ts re-points owners from provenance; the
    // rehearsal's offender has none, so it falls to the documented last resort —
    // detach the foreign supplier (products.supplier_id is nullable by design).
    const rows = await sql`
      update products p set supplier_id = null
      from suppliers s
      where p.supplier_id = s.id and s.restaurant_id <> p.restaurant_id
      returning p.id`;
    return rows.length;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (scratch DB) is required');
  const local = /localhost|127\.0\.0\.1|_test|scratch|rehears/i.test(url);
  if (!local && !process.argv.includes('--i-understand-this-writes')) {
    throw new Error('[rehearse] refusing to write to a non-local DB — pass --i-understand-this-writes for a restored dump');
  }
  const skipSeed = process.argv.includes('--skip-seed');

  console.log(`[rehearse] 1/5 applying journal through ${PROD_LEVEL} (production level)`);
  await runMigrator(url, truncatedMigrationsFolder(PROD_LEVEL));

  if (!skipSeed) {
    console.log('[rehearse] 2/5 seeding a NULL-tenant scan + a cross-tenant product, expecting 0020 to refuse');
    await seedOffenders(url);
    await expectMigratorFailure(url, /NULL restaurant_id|backfill before NOT NULL/i, '0020 unscoped-scan guard');
    const removed = await repairUnscopedScans(url);
    console.log(`[rehearse]     repaired: removed ${removed} walk-in scan row(s); expecting 0021 to refuse the cross-tenant product`);
    await expectMigratorFailure(url, /products_supplier_same_tenant_fk|foreign key|violates/i, '0021 same-tenant FK');
    const repointed = await repairCrossTenantProducts(url);
    console.log(`[rehearse]     repaired: detached ${repointed} cross-tenant product(s)`);
  } else {
    console.log('[rehearse] 2/5 --skip-seed: rehearsing against the dump\'s own rows');
  }

  console.log('[rehearse] 3/5 applying 0019→latest');
  await runMigrator(url, DRIZZLE_DIR);

  console.log('[rehearse] 4/5 provisioning RLS (0002 + 0003) + restomatch_app');
  await applyCoreTenantRls(url);
  await applyAuditImmutableRls(url);
  await ensureRlsAppRole(url);

  console.log('[rehearse] 5/5 post-cutover checks');
  const results = await runCutoverChecks(url, { checkDefaultPassword: false });
  console.log(formatCheckTable(results));
  const failed = results.filter((r) => !r.ok && !r.skipped);
  if (failed.length > 0) {
    throw new Error(`[rehearse] ${failed.length} post-cutover check(s) failed`);
  }
  console.log('\n[rehearse] ✔ rehearsal complete — the production sequence in docs/GO-LIVE.md §E is safe to run');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
