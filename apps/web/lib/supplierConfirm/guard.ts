import 'server-only';
import { clientIpFromHeaders } from '@restomatch/api';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * Page-view limit for the public supplier portal (/s/[token]). POSTs go through
 * the shared `guardPublicRequest` (lib/publicGuard) in the route handler; a page
 * render has no Request object, so views use the same limiter store directly.
 */
export const SUPPLIER_BODY_MAX_BYTES = 16 * 1024;
const VIEW_LIMIT = { limit: 60, windowSec: 600, prefix: 'rl:supplier-view' };

export async function guardSupplierView(headers: Headers): Promise<{ error: 'rate_limited' } | null> {
  const ip = clientIpFromHeaders(headers, { trustedProxyHops: trustedProxyHops() });
  const rl = await enforceRateLimit(ip, VIEW_LIMIT);
  return rl.allowed ? null : { error: 'rate_limited' };
}
