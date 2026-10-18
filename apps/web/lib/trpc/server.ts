import { cache } from 'react';
import { appRouter, type AppContext } from '@restomatch/api';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { authDb } from '@/lib/authDb';

/**
 * One caller per server request. The dashboard layout and the page both need a
 * caller; without `cache` each one re-ran `auth()` (JWT decode + the
 * session-security DB read). `cache` is request-scoped in RSC renders and a
 * plain pass-through in server actions / route handlers.
 */
export const createServerCaller = cache(async function createServerCaller() {
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
});
