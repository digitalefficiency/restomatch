import 'server-only';
import { clientIpFromHeaders, type IngestHttpDeps } from '@restomatch/api';
import { db } from '@/lib/db';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

/**
 * Wiring for the public /api/ingest/** webhooks: the RLS-enforced app
 * connection (the tenant comes only from the hashed token, then every write
 * runs under that restaurant's GUC), the shared Redis/memory rate-limit store
 * and the proxy-aware client IP.
 */
export function ingestDeps(req: Request): IngestHttpDeps {
  return {
    db,
    rateLimit: enforceRateLimit,
    clientIp: clientIpFromHeaders(req.headers, { trustedProxyHops: trustedProxyHops() }),
  };
}
