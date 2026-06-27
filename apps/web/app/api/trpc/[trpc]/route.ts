import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import {
  appRouter,
  clientIpFromHeaders,
  isOriginAllowed,
  trpcRequestTargets,
  type AppContext,
  type RateLimitOptions,
} from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { authDb } from '@/lib/authDb';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';

// Per-IP limits on the sensitive/unauthenticated tRPC procedures (defense in
// depth on top of each procedure's own validation). Redis-backed when REDIS_URL
// is set, in-memory otherwise (enforceRateLimit fails open). D1.6.
//  - leads.create: public, unauthenticated write surface (caps volume).
//  - team.acceptInvite: token-redemption surface — throttle invite-token probing.
const PER_PROCEDURE_LIMITS: Array<{ procedure: string; opts: RateLimitOptions }> = [
  { procedure: 'leads.create', opts: { limit: 10, windowSec: 60 * 60, prefix: 'leads' } },
  { procedure: 'team.acceptInvite', opts: { limit: 20, windowSec: 60 * 60, prefix: 'accept-invite' } },
];

async function createContext(): Promise<AppContext> {
  const session = await auth();
  return {
    db,
    adminDb: authDb,
    session: session?.user?.id
      ? {
          userId: session.user.id,
          restaurantId: session.user.restaurantId ?? null,
          role: session.user.role ?? null,
        }
      : null,
  };
}

const handler = async (req: Request) => {
  // CSRF defense: cookie-authed mutations must originate from this deployment.
  if (
    !isOriginAllowed({
      method: req.method,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      allowedUrls: [process.env.AUTH_URL, process.env.NEXTAUTH_URL, process.env.APP_URL],
    })
  ) {
    return new Response(JSON.stringify({ error: 'origin not allowed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Per-IP rate limits on the sensitive procedures (a batched request can target
  // several, so check each). IP is attributed via a trusted proxy hop, not the
  // spoofable left-most x-forwarded-for entry (D1.6).
  const ip = clientIpFromHeaders(req.headers, { trustedProxyHops: trustedProxyHops() });
  for (const { procedure, opts } of PER_PROCEDURE_LIMITS) {
    if (!trpcRequestTargets(procedure, req.method, req.url)) continue;
    const rl = await enforceRateLimit(ip, opts);
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': String(rl.resetSec) },
      });
    }
  }

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });
};

export { handler as GET, handler as POST };
