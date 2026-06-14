/**
 * Request-edge helpers for the tRPC fetch handler.
 *
 * The web route handler (apps/web/app/api/trpc/[trpc]/route.ts) needs to
 * rate-limit specific PUBLIC procedures (e.g. leads.create) by client IP. The
 * procedure name lives in the tRPC URL path and AppContext deliberately carries
 * no IP, so the decision is made here, at the edge, before the request reaches
 * the router. These are pure functions so they unit-test in CI without a Next
 * runtime.
 */

/** Minimal Headers shape — keeps this runtime-agnostic and easy to test. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Best-effort client IP: first hop of `x-forwarded-for`, else `x-real-ip`, else
 * `'unknown'`. Vercel and most proxies set `x-forwarded-for`. `'unknown'` means
 * all un-attributable requests share one bucket — strict, never permissive.
 */
export function clientIpFromHeaders(headers: HeaderReader): string {
  const xff = headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0]!.trim();
  const real = headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  return 'unknown';
}

/**
 * True when a tRPC fetch request targets `procedure`. The fetch adapter encodes
 * the procedure(s) in the path (`/api/trpc/leads.create`); batched calls are
 * comma-joined (`/api/trpc/leads.create,plans.list`). Exact-segment match, so
 * `leads.createSomething` never trips a `leads.create` limiter. Mutations are
 * POST, so non-POST requests are never matched.
 */
export function trpcRequestTargets(procedure: string, method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const after = pathname.split('/api/trpc/')[1];
  if (!after) return false;
  return after.split(',').some((seg) => {
    try {
      return decodeURIComponent(seg) === procedure;
    } catch {
      return seg === procedure;
    }
  });
}
