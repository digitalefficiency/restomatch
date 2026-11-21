import 'server-only';
import { clientIpFromHeaders } from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * Page-view limit for the reply link (/s/c/[token]). The POST goes through
 * guardPublicRequest in /api/claims/[token]; a page render has no Request, so
 * views use the same limiter store directly, per IP across all links.
 */
const VIEW_LIMIT = { limit: 60, windowSec: 600, prefix: 'rl:claim-portal-view' };

export async function guardClaimView(headers: Headers): Promise<boolean> {
  const ip = clientIpFromHeaders(headers, { trustedProxyHops: trustedProxyHops() });
  return (await enforceRateLimit(ip, VIEW_LIMIT)).allowed;
}
