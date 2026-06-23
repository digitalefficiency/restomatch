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
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().url().optional(),
  APP_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
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
    if (!v.AUTH_URL && !v.APP_URL) missing.push('AUTH_URL or APP_URL');
    if (!v.REDIS_URL) missing.push('REDIS_URL — OCR/match/cron queue (uploads vanish without it)');
    if (!v.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY — signed scan URLs');
    if (missing.length > 0) {
      throw new Error(`[env] missing required production secrets:\n - ${missing.join('\n - ')}`);
    }
  }
  return v;
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
