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

export interface ClientIpOptions {
  /**
   * Number of TRUSTED reverse proxies between the client and this app. The
   * client IP is read that many hops from the RIGHT of `x-forwarded-for` — the
   * entries your own trusted infra appends, which a client cannot forge. Vercel
   * / Cloudflare are typically `1`. Default `0` keeps the legacy (left-most)
   * behaviour for environments where the proxy depth isn't declared.
   */
  trustedProxyHops?: number;
}

/**
 * Best-effort client IP for rate-limiting attribution.
 *
 * `x-forwarded-for` is a client-appendable chain (`client, proxy1, proxy2`). The
 * LEFT-most entry is whatever the original caller claimed and is therefore
 * spoofable; only the entries appended by trusted proxies (counting from the
 * RIGHT) are reliable. With `trustedProxyHops = N` we take the Nth-from-last
 * entry; with `0` we fall back to the left-most (legacy). `x-real-ip` is the
 * next fallback, then `'unknown'` — which buckets all un-attributable requests
 * together (strict, never permissive). D1.6.
 */
export function clientIpFromHeaders(headers: HeaderReader, opts: ClientIpOptions = {}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff && xff.trim()) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hops.length > 0) {
      const trusted = opts.trustedProxyHops ?? 0;
      if (trusted > 0) {
        // Take the entry `trusted` hops from the right; clamp so an attacker who
        // sends a SHORTER chain than expected can't push the index negative.
        const idx = Math.max(0, hops.length - trusted);
        return hops[idx]!;
      }
      return hops[0]!;
    }
  }
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
