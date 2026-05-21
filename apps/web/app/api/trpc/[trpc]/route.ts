import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, type AppContext } from '@restomatch/api';
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

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
