/**
 * Pure CSRF/Origin check for the tRPC fetch handler.
 *
 * tRPC mutations are cookie-authenticated POSTs, so a third-party page could
 * trigger them cross-site. We require the Origin header (which browsers attach
 * to every cross-origin request and to same-origin POSTs) to match an allowed
 * host. A missing Origin is only accepted for GET (same-origin navigations and
 * non-browser read clients).
 */

export interface OriginCheckInput {
  method: string;
  origin: string | null;
  host: string | null;
  /** Extra allowed origins/urls (e.g. AUTH_URL); host is parsed out. */
  allowedUrls?: Array<string | undefined>;
}

export function isOriginAllowed(input: OriginCheckInput): boolean {
  const { origin, method, host, allowedUrls = [] } = input;

  if (!origin) {
    return method.toUpperCase() === 'GET';
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const allowed = new Set<string>();
  if (host) allowed.add(host);
  for (const url of allowedUrls) {
    if (!url) continue;
    try {
      allowed.add(new URL(url).host);
    } catch {
      /* ignore malformed entries */
    }
  }
  return allowed.has(originHost);
}
