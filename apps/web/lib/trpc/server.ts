import { appRouter, type AppContext } from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { authDb } from '@/lib/authDb';

export async function createServerCaller() {
  const session = await auth();
  const ctx: AppContext = {
    db,
    // Cross-tenant admin queries run on the owner connection (bypass RLS).
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
  return appRouter.createCaller(ctx);
}
