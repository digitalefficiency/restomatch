import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, isOriginAllowed, type AppContext } from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';

async function createContext(): Promise<AppContext> {
  const session = await auth();
  return {
    db,
    session: session?.user?.id
      ? {
          userId: session.user.id,
          restaurantId: session.user.restaurantId ?? null,
          role: session.user.role ?? null,
        }
      : null,
  };
}

const handler = (req: Request) => {
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
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });
};

export { handler as GET, handler as POST };
