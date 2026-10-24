import { z } from 'zod';
import { sql } from '@restomatch/db';
import type { Database } from '@restomatch/db';

/**
 * Fail-fast environment validation for the web app.
 *
 * The app must NOT boot into production with missing secrets and then degrade
 * silently (lost invoices on an unset REDIS_URL, dead login on an unset
 * RESEND_API_KEY, inert RLS on an unset DATABASE_URL_APP). Call assertWebEnv()
 * once at startup (instrumentation) to turn those into a LOUD boot failure.
 *
 * Opt-in by design: importing this module has no side effects; nothing runs
 * until a caller invokes assertWebEnv() / assertAppRoleNoBypass().
 */
const WebEnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_APP: z.string().min(1).optional(),
  // Dev/test escape hatch: explicitly opt in to serving tenant traffic on the
  // owner DATABASE_URL (which BYPASSES RLS) when DATABASE_URL_APP is unset.
  // Rejected in production — there the non-owner app role is mandatory.
  ALLOW_OWNER_DB: z.string().optional(),
  AUTH_SECRET: z.string().optional(), // '' = unset (checked below), never a parse error
  // Auth.js v4 name — still honoured by next-auth v5 as a fallback.
  NEXTAUTH_SECRET: z.string().optional(), // '' = unset (checked below), never a parse error
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(), // '' = unset (checked below), never a parse error
  SUPABASE_URL: z.string().optional(), // '' = unset (checked below), never a parse error
  AUTH_URL: z.string().url().optional(),
  APP_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Name the Supabase↔Vercel integration syncs for the new-style secret key.
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
  // Symmetric key (32 bytes; hex/base64) used to encrypt the TOTP secret at rest
  // (user_credentials.totp_secret_enc, Epic C). Required in production so 2FA
  // secrets are never stored in plaintext. Validated below.
  AUTH_ENC_KEY: z.string().min(1).optional(),
});

export type WebEnv = z.infer<typeof WebEnvSchema>;

/**
 * Validate process.env. In production, also hard-require the secrets whose
 * absence silently breaks core flows. Throws a single readable error listing
 * everything wrong.
 */
export function assertWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  const parsed = WebEnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    throw new Error(`[env] invalid web environment:\n${JSON.stringify(fields, null, 2)}`);
  }
  const v = parsed.data;
  if ((v.NODE_ENV ?? env.NODE_ENV) === 'production') {
    const missing: string[] = [];
    if (!v.DATABASE_URL_APP) missing.push('DATABASE_URL_APP — RLS app-role connection (RLS is inert without it)');
    if (!v.RESEND_API_KEY) missing.push('RESEND_API_KEY — magic-link login + invites');
    if (!v.EMAIL_FROM) missing.push('EMAIL_FROM — verified sender domain');
    if (!v.AUTH_URL && !v.APP_URL && !env.NEXTAUTH_URL) missing.push('AUTH_URL or APP_URL');
    // Without it the app BOOTS and then every sign-in 500s (Auth.js
    // MissingSecret) — make it a boot failure instead (F4).
    if (!v.AUTH_SECRET && !v.NEXTAUTH_SECRET)
      missing.push('AUTH_SECRET (or NEXTAUTH_SECRET) — signs the session JWT; every login fails without it');
    if (!v.REDIS_URL) missing.push('REDIS_URL — OCR/match/cron queue (uploads vanish without it)');
    if (!v.SUPABASE_SERVICE_ROLE_KEY && !v.SUPABASE_SECRET_KEY)
      missing.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) — signed scan URLs');
    // AUTH_ENC_KEY encrypts the TOTP secret at rest (Epic C). Required in prod so
    // 2FA secrets are never plaintext.
    // NOTE on AUTH_SECRET rotation: AUTH_SECRET signs/encrypts the session JWT.
    // Rotating it invalidates EVERY live token at once — including long-lived
    // "remember me" sessions (up to 30d) — forcing a full re-login. To rotate
    // without a mass logout, pass AUTH_SECRET as an array (old + new) so old
    // tokens still verify during the overlap window, then drop the old key.
    if (!v.AUTH_ENC_KEY)
      missing.push('AUTH_ENC_KEY — encrypts the TOTP secret at rest (2FA, Epic C)');
    if (missing.length > 0) {
      throw new Error(`[env] missing required production secrets:\n - ${missing.join('\n - ')}`);
    }
    // The owner-DB escape hatch must never be honoured in production: tenant
    // traffic on an RLS-bypassing connection silently defeats tenant isolation.
    if (isTruthyFlag(v.ALLOW_OWNER_DB)) {
      throw new Error(
        '[env] ALLOW_OWNER_DB is set in production — refusing to serve tenant traffic on the ' +
          'RLS-bypassing owner connection. Unset it and provision DATABASE_URL_APP (restomatch_app).',
      );
    }
  }
  for (const warning of webEnvWarnings(env)) console.warn(warning);
  return v;
}

/** Supabase project ref of an API URL (`https://<ref>.supabase.co`), or null. */
export function supabaseRefFromUrl(url: string): string | null {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url.trim());
  return m ? m[1]! : null;
}

/**
 * Supabase project ref of a Postgres URL, or null when it isn't a Supabase DB:
 * pooler users are `<role>.<ref>` (…pooler.supabase.com), direct hosts are
 * `db.<ref>.supabase.co`.
 */
export function supabaseRefFromDbUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    if (host) return host[1]!;
    if (!u.hostname.endsWith('.supabase.com') && !u.hostname.endsWith('.supabase.co')) return null;
    const user = /\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username));
    return user ? user[1]! : null;
  } catch {
    return null;
  }
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Non-fatal configuration smells, logged at boot (assertWebEnv). Messages name
 * project refs / origins only — never credentials or full connection strings.
 *  - F5: the DB URLs and the Supabase API URL belong to different projects
 *    (a leftover from the old project — scans/signing hit the wrong backend).
 *  - F6: APP_URL and AUTH_URL have different origins — Auth.js builds callback
 *    URLs from AUTH_URL, so opening the app on the other host loops on login.
 */
export function webEnvWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  // WARN, never throw: a malformed value is a likely leftover from another
  // project, but bricking a live deploy over it would be worse than the leftover.
  if (env.NODE_ENV === 'production') {
    const bad = (['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const).filter(
      (k) => env[k] !== undefined && env[k] !== '' && supabaseRefFromUrl(env[k]!) === null,
    );
    if (bad.length > 0) {
      warnings.push(
        `[env] WARNING: ${bad.join(' / ')} should look like https://<project-ref>.supabase.co ` +
          '(no path) — check for a leftover value from another project.',
      );
    }
  }
  const refs = new Map<string, string>();
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const) {
    const ref = env[k] ? supabaseRefFromUrl(env[k]!) : null;
    if (ref) refs.set(k, ref);
  }
  for (const k of ['DATABASE_URL', 'DATABASE_URL_APP', 'DATABASE_URL_DIRECT'] as const) {
    const ref = env[k] ? supabaseRefFromDbUrl(env[k]!) : null;
    if (ref) refs.set(k, ref);
  }
  if (new Set(refs.values()).size > 1) {
    const list = [...refs].map(([k, ref]) => `${k}=${ref}`).join(', ');
    warnings.push(`[env] WARNING: Supabase project refs differ (${list}) — one of them is probably a leftover from another project.`);
  }
  const app = originOf(env.APP_URL);
  const authOrigin = originOf(env.AUTH_URL);
  if (app && authOrigin && app !== authOrigin) {
    warnings.push(
      `[env] WARNING: APP_URL origin (${app}) differs from AUTH_URL origin (${authOrigin}). ` +
        'Sign-in callbacks use AUTH_URL — open the app only on that host or login will loop.',
    );
  }
  return warnings;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Resolve the connection string the web app uses for TENANT queries, fail-closed.
 *
 * Prefer the non-owner DATABASE_URL_APP (RLS-enforced). The owner DATABASE_URL
 * BYPASSES RLS, so falling back to it silently disables tenant isolation — we do
 * that ONLY when explicitly opted in for local dev/test (ALLOW_OWNER_DB=1 or
 * NODE_ENV=test). Otherwise an unset DATABASE_URL_APP is a LOUD boot failure
 * rather than a silent owner fallback.
 */
export function resolveWebDbUrl(env: NodeJS.ProcessEnv = process.env): string {
  const appUrl = env.DATABASE_URL_APP;
  if (appUrl && appUrl.length > 0) return appUrl;

  const ownerFallbackAllowed =
    (env.NODE_ENV ?? 'development') === 'test' || isTruthyFlag(env.ALLOW_OWNER_DB);
  if (ownerFallbackAllowed && env.DATABASE_URL) return env.DATABASE_URL;

  throw new Error(
    '[env] DATABASE_URL_APP is required: the web app must serve tenant traffic on the non-owner ' +
      'restomatch_app role so RLS is enforced. For local dev against the owner DB set ALLOW_OWNER_DB=1 ' +
      '(never in production).',
  );
}

/**
 * Boot guard for the tenant boundary: assert the connection the web uses for
 * tenant queries is a NON-superuser role that does NOT bypass RLS. If
 * DATABASE_URL_APP was misconfigured to the owner/service role, RLS is silently
 * inert — this turns that into a loud failure. Call once at startup with the
 * app-role db. No-op-safe to call in any env.
 */
export async function assertAppRoleNoBypass(db: Database): Promise<void> {
  const rows = await db.execute<{ rolbypassrls: boolean; current_user: string }>(
    sql`select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls`,
  );
  const row = (rows as unknown as Array<{ rolbypassrls: boolean; current_user: string }>)[0];
  if (row?.rolbypassrls) {
    throw new Error(
      `[env] tenant-boundary guard FAILED: the web DB connection runs as "${row.current_user}" which BYPASSES RLS. ` +
        `Point DATABASE_URL_APP at the non-owner restomatch_app role before serving tenants.`,
    );
  }
}

/**
 * Drift guard for RLS provisioning (Epic 0.3): assert every public table that
 * carries a `restaurant_id` column actually has row-level security ENABLED. The
 * RLS SQL (drizzle/rls/0002) is applied out-of-band (not via db:migrate), so a
 * forgotten apply or a brand-new tenant table would otherwise be a silent
 * cross-tenant exposure. This turns it into a loud boot failure.
 *
 * Safe to call on any connection (read-only catalog query). Call once at startup
 * AFTER assertAppRoleNoBypass.
 */
export async function assertRlsEnabled(db: Database): Promise<void> {
  const rows = (await db.execute(
    sql`
      select c.table_name
      from information_schema.columns c
      join pg_class pc on pc.relname = c.table_name
      join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public'
        and c.column_name = 'restaurant_id'
        and not pc.relrowsecurity
      order by c.table_name
    `,
  )) as unknown as Array<{ table_name: string }>;
  if (rows.length > 0) {
    const tables = rows.map((r) => r.table_name).join(', ');
    throw new Error(
      `[env] RLS provisioning INCOMPLETE: tables carry restaurant_id but row-level security is ` +
        `DISABLED: ${tables}. Apply packages/db/drizzle/rls/0002_core_tenant_rls.sql (see ` +
        `packages/db/scripts/provision-rls.ts) before serving tenants.`,
    );
  }
}
