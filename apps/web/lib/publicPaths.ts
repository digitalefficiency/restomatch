/**
 * Public (no-session) routes — the ONE list the middleware consults.
 *
 * Edge-safe (pure). Anything not listed redirects anonymous visitors to /login
 * (pages) or returns a JSON 401 (/api/*). Keep marketing + legal + auth-recovery
 * pages here; keep /scans, /admin, /dashboard, /set-password OUT (they re-check
 * the session themselves and must keep redirecting).
 *
 * Plan v2 R7: /reset (password reset, incl. the emailed ?token= link) and the
 * Amendment-13 duty-to-inform pages (/privacy, /terms, /cookies) were missing,
 * so signed-out users bounced to /login.
 */
export const PUBLIC_EXACT_PATHS = [
  '/',
  '/pricing',
  '/about',
  '/privacy',
  '/terms',
  '/cookies',
  // Generated SEO/social route (no file extension in the URL, so the static-asset
  // rule below doesn't catch it) — crawlers have no session. The share cards
  // (/og/*.png) and /opengraph-image never reach the middleware at all (matcher).
  '/twitter-image',
] as const;

/** Prefixes match the path itself or any sub-path (`/login`, `/login/2fa`). */
export const PUBLIC_PREFIX_PATHS = [
  '/login',
  '/reset',
  '/showcase',
  '/api/showcase',
  '/api/auth',
  '/api/trpc', // auth is enforced PER PROCEDURE (publicProcedure runs anonymously) — D1.4
  '/api/healthz',
  '/api/cron', // Vercel Cron; each route verifies CRON_SECRET itself
  '/api/inbound', // reserved for the Wave-3 inbox webhook (signature-verified per route)
  // S13 invoice ingestion webhooks (WhatsApp / inbound e-mail). Each route verifies
  // the provider HMAC, rate-limits, caps sizes and resolves the tenant ONLY from a
  // hashed secret token — see packages/api/src/ingest/http.ts + ingest.attack.test.ts.
  '/api/ingest',
  '/_next',
] as const;

/**
 * Only the LAST path segment having a file extension marks a static asset — a
 * dot anywhere in the path (e.g. a dynamic /scans/<id-with-dot>) must not make a
 * dynamic route accidentally public.
 */
export function looksLikeStaticAsset(path: string): boolean {
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return /\.[a-z0-9]+$/i.test(lastSegment);
}

export function isPublicPath(path: string): boolean {
  if ((PUBLIC_EXACT_PATHS as readonly string[]).includes(path)) return true;
  for (const prefix of PUBLIC_PREFIX_PATHS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return looksLikeStaticAsset(path);
}
