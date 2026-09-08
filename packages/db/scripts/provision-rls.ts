/**
 * Idempotent RLS provisioning (Epic 0.3).
 *
 * Turns the manual psql cutover (DEPLOY_CUTOVER.md) into a reviewed, repeatable
 * artifact: apply the core tenant policies (0002) + the audit-immutability layer
 * (0003), then create/grant the non-owner `restomatch_app` role. Safe to re-run.
 *
 * Connection: owner/admin DATABASE_URL (the role must own the tables / bypass
 * RLS to ALTER them). The web app then connects with the printed app role.
 *
 *   pnpm --filter @restomatch/db provision-rls
 *
 * Storage (0001, Supabase-only: touches storage.buckets/objects) is OPT-IN via
 * PROVISION_STORAGE_RLS=1 and only attempted when the storage schema exists.
 *
 * ⛔ This script is NOT run automatically against production. Apply to staging
 * first and follow docs/RLS-PROVISIONING-RUNBOOK.md (STOP-FOR-APPROVAL gate).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { applyAuditImmutableRls, applyCoreTenantRls, ensureRlsAppRole } from '../src/rls';

async function maybeApplyStorageRls(url: string): Promise<boolean> {
  if (process.env.PROVISION_STORAGE_RLS !== '1') return false;
  const client = postgres(url, { max: 1, prepare: false });
  try {
    const rows = (await client`
      select exists (select 1 from information_schema.schemata where schema_name = 'storage') as exists
    `) as unknown as Array<{ exists: boolean }>;
    if (!rows[0]?.exists) {
      console.warn('[provision-rls] PROVISION_STORAGE_RLS=1 but no `storage` schema — skipping 0001');
      return false;
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const sqlText = readFileSync(join(here, '..', 'drizzle', 'rls', '0001_invoice_scans_rls.sql'), 'utf8');
    await client.unsafe(sqlText);
    return true;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.PROVISION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (owner) is required to provision RLS');

  console.log('[provision-rls] applying 0002_core_tenant_rls (per-restaurant policies)');
  await applyCoreTenantRls(url);

  console.log('[provision-rls] applying 0003_audit_immutable (append-only audit_log)');
  await applyAuditImmutableRls(url);

  console.log('[provision-rls] ensuring restomatch_app role + grants/revokes (password from APP_ROLE_PASSWORD)');
  const appUrl = await ensureRlsAppRole(url);

  const storage = await maybeApplyStorageRls(url);
  console.log(`[provision-rls] storage RLS (0001): ${storage ? 'applied' : 'skipped'}`);

  console.log('[provision-rls] done. Set DATABASE_URL_APP (Vercel → Production) to the restomatch_app connection string.');
  if (process.argv.includes('--print-app-url')) {
    // Contains the password — printed only on request, never in CI logs.
    console.log(`[provision-rls] DATABASE_URL_APP=${appUrl}`);
  } else {
    console.log('[provision-rls] (re-run with --print-app-url to print the full DATABASE_URL_APP once)');
  }
}

main().catch((err) => {
  console.error('[provision-rls] failed', err);
  process.exit(1);
});
