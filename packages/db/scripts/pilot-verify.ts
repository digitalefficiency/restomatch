/**
 * Read-only check of a provisioned pilot tenant (docs/PILOT-SETUP.md, step 4).
 *
 *   DATABASE_URL=… pnpm --filter @restomatch/db pilot:verify -- \
 *     --restaurant <uuid> --expect-project <ref> [--expect-flags contracts,recovery,…]
 *
 * With PILOT_CONFIG set, the expected flags are the config's `true` features.
 * Runs inside BEGIN READ ONLY, prints PASS / FAIL / SKIP per check and a last
 * line VERIFY: PASS|FAIL (exit 1 on FAIL). Never writes, never prints secrets.
 */
import { pathToFileURL } from 'node:url';

import postgres from 'postgres';

import { DEMO_BRANCH_NAMES, DEMO_EMAIL_DOMAIN, DEMO_MAIN_BUSINESS_ID, DEMO_MAIN_NAME } from '../src/demoTenants';
import { loadConfigFile, PilotError, targetProblem } from './pilot-setup';

export interface VerifyCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

export interface VerifyOptions {
  url: string;
  restaurantId: string;
  expectProject?: string;
  expectFlags?: string[];
  env?: NodeJS.ProcessEnv;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runPilotVerify(o: VerifyOptions): Promise<VerifyCheck[]> {
  const problems: string[] = [];
  const target = targetProblem(o.url, o.expectProject, o.env);
  if (target) problems.push(target);
  if (!UUID.test(o.restaurantId ?? '')) problems.push('--restaurant <uuid> is required');
  if (problems.length) throw new PilotError(problems);

  const out: VerifyCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => out.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  const sql = postgres(o.url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql.begin('read only', async (tx) => {
      const rid = o.restaurantId;
      // 1. restaurant + settings
      const [r] = (await tx`select name, settings from restaurants where id = ${rid}`) as unknown as Array<{ name: string; settings: Record<string, unknown> | null }>;
      if (!r) {
        check('restaurant', false, `no restaurant ${rid}`);
        return;
      }
      const s = r.settings ?? {};
      const features = (s.features ?? {}) as Record<string, unknown>;
      const on = Object.keys(features).filter((k) => features[k] === true).sort();
      const missing = (o.expectFlags ?? []).filter((f) => features[f] !== true);
      check('restaurant', true, r.name);
      check('settings.tolerances', !!s.tolerances && typeof s.tolerances === 'object', s.tolerances ? 'present' : 'missing');
      check(
        'settings.features',
        missing.length === 0 && features.all !== true,
        features.all === true
          ? 'features.all is on — a pilot gets an explicit list'
          : missing.length
            ? `missing: ${missing.join(', ')}`
            : `on: ${on.join(', ') || '(none)'}`,
      );

      // 2. storage namespace
      const ns = (await tx`select prefix from storage_namespaces where restaurant_id = ${rid} and bucket = 'invoice-scans'`) as unknown as Array<{ prefix: string }>;
      check('storage_namespace', ns[0]?.prefix === `${rid}/`, ns[0] ? `invoice-scans/${ns[0].prefix}` : 'missing');

      // 3. suppliers: name → vat_rate (an unset rate falls back to the restaurant's 18%)
      const sup = (await tx`select name, vat_rate::text as vat from suppliers where restaurant_id = ${rid} and active order by name`) as unknown as Array<{ name: string; vat: string | null }>;
      const unset = sup.filter((x) => x.vat == null);
      check(
        'suppliers.vat_rate',
        unset.length === 0,
        sup.length ? sup.map((x) => `${x.name} → ${x.vat == null ? 'unset' : `${Number(x.vat) * 100}%`}`).join(', ') : 'no suppliers',
      );

      // 4. no member spans the demo and a real tenant
      // Demo restaurants by identity (as findDemoTenants, without its refusal: a mixed
      // world is exactly what this check reports).
      const demoRows = (await tx`
        with main as (select id, billing_account_id from restaurants where business_id = ${DEMO_MAIN_BUSINESS_ID} and name = ${DEMO_MAIN_NAME})
        select id::text from main
        union select r.id::text from restaurants r join main on r.billing_account_id = main.billing_account_id
        where r.name in ${tx(DEMO_BRANCH_NAMES as string[])}`) as unknown as Array<{ id: string }>;
      const demoIds = demoRows.map((x) => x.id);
      const [cross] = demoIds.length
        ? ((await tx`
            select count(distinct m1.user_id)::int as n from memberships m1
            join memberships m2 on m2.user_id = m1.user_id
            where m1.restaurant_id in ${tx(demoIds)} and m2.restaurant_id not in ${tx(demoIds)}`) as unknown as Array<{ n: number }>)
        : [{ n: 0 }];
      check('no_demo_cross_membership', cross!.n === 0, `${cross!.n} user(s) are members of the demo AND a real tenant`);

      // 5. platform admins, by email domain only
      const admins = (await tx`
        select split_part(lower(email), '@', 2) as domain, count(*)::int as n from users where is_platform_admin group by 1 order by 1`) as unknown as Array<{ domain: string; n: number }>;
      const demoAdmins = admins.filter((a) => a.domain === DEMO_EMAIL_DOMAIN || a.domain.endsWith('.test'));
      check('platform_admins', demoAdmins.length === 0, admins.map((a) => `${a.domain}: ${a.n}`).join(', ') || 'none');

      // 6. tenant tables without RLS
      const noRls = (await tx`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
        where c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`) as unknown as Array<{ relname: string }>;
      check('rls_on_tenant_tables', noRls.length === 0, noRls.length ? `RLS off: ${noRls.map((x) => x.relname).join(', ')}` : '0 tenant tables without RLS');

      // 7. anon / authenticated table grants on public
      const grants = (await tx`
        select grantee, count(*)::int as n from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated') group by 1`) as unknown as Array<{ grantee: string; n: number }>;
      const nGrants = grants.reduce((a, g) => a + g.n, 0);
      check('public_grants_anon_authenticated', nGrants === 0, nGrants ? grants.map((g) => `${g.grantee}: ${g.n}`).join(', ') : '0');

      // 8. invoice-scans bucket private (Supabase only)
      const [st] = (await tx`select to_regclass('storage.buckets') is not null as e`) as unknown as Array<{ e: boolean }>;
      if (st!.e) {
        const b = (await tx`select public from storage.buckets where id = 'invoice-scans'`) as unknown as Array<{ public: boolean }>;
        check('invoice_scans_bucket_private', b.length === 1 && b[0]!.public === false, b.length ? `public=${b[0]!.public}` : 'bucket missing');
      } else {
        out.push({ name: 'invoice_scans_bucket_private', status: 'SKIP', detail: 'no storage schema (not Supabase)' });
      }

      // 9. billing
      const [bill] = (await tx`
        select p.key, s.status::text as status, s.trial_ends_at from restaurants r
        join subscriptions s on s.billing_account_id = r.billing_account_id
        join plans p on p.id = s.plan_id
        where r.id = ${rid} order by s.created_at desc limit 1`) as unknown as Array<{ key: string; status: string; trial_ends_at: Date | null }>;
      check(
        'billing',
        true,
        bill
          ? `plan ${bill.key} · ${bill.status}${bill.trial_ends_at ? ` · trial ends ${bill.trial_ends_at.toISOString().slice(0, 10)}` : ''}`
          : 'no subscription (implicit trial)',
      );
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
  return out;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new PilotError(['DATABASE_URL is required']);
  const flagArg = arg(argv, 'expect-flags');
  const expectFlags = flagArg
    ? flagArg.split(',').map((s) => s.trim()).filter(Boolean)
    : process.env.PILOT_CONFIG
      ? Object.entries(loadConfigFile(process.env.PILOT_CONFIG).features).filter(([, v]) => v).map(([k]) => k)
      : [];
  const checks = await runPilotVerify({ url, restaurantId: arg(argv, 'restaurant') ?? '', expectProject: arg(argv, 'expect-project'), expectFlags });
  for (const c of checks) console.log(`${c.status.padEnd(4)}  ${c.name.padEnd(34)} ${c.detail}`);
  const ok = !checks.some((c) => c.status === 'FAIL');
  console.log(`VERIFY: ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err: unknown) => {
      if (err instanceof PilotError) {
        for (const p of err.problems) console.error(`[pilot:verify] ✘ ${p}`);
        process.exit(2);
      }
      console.error('[pilot:verify] failed', err);
      process.exit(1);
    });
}
