import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import {
  appRouter,
  clientIpFromHeaders,
  isOriginAllowed,
  trpcRequestTargets,
  type AppContext,
} from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { authDb } from '@/lib/authDb';
import { enforceRateLimit } from '@/lib/rateLimit';

// Public lead capture (leads.create) is an unauthenticated write surface, so
// throttle it per client IP for defense in depth (the honeypot + bounded
// strings in leads.ts handle content abuse; this caps volume). Redis-backed
// when REDIS_URL is set, in-memory otherwise (enforceRateLimit fails open).
const LEADS_RATE_LIMIT = { limit: 10, windowSec: 60 * 60, prefix: 'leads' };

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
          // Epic C: a 2FA-pending first factor is not a usable session.
          twoFactorPending: session.user.twoFactorPending === true,
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

  // Per-IP rate limit on the public lead-capture endpoint.
  if (trpcRequestTargets('leads.create', req.method, req.url)) {
    const rl = await enforceRateLimit(clientIpFromHeaders(req.headers), LEADS_RATE_LIMIT);
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
