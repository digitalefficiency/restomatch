import { timingSafeEqual } from 'node:crypto';

/**
 * Vercel Cron auth, shared by the /api/cron/* routes.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set in
 * the project env. Without the header (or with a wrong one) → not authorized.
 * With no CRON_SECRET configured, production refuses every call; development
 * and tests skip the check.
 */
export function cronAuthorized(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return env.NODE_ENV !== 'production';
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
