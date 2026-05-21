import { appRouter, type AppContext } from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';

export async function createServerCaller() {
  const session = await auth();
  const ctx: AppContext = {
    db,
    session: session?.user?.id
      ? {
          userId: session.user.id,
          restaurantId: session.user.restaurantId ?? null,
          role: session.user.role ?? null,
        }
      : null,
  };
  return appRouter.createCaller(ctx);
}
