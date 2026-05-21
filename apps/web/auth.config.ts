import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-runtime safe configuration: no providers that pull node-only deps,
 * no DB adapter. Used by middleware.
 */
export const authConfig = {
  trustHost: true,
  pages: {
    signIn: '/login',
    verifyRequest: '/login/check-email',
  },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      type AppJwt = {
        userId?: string;
        restaurantId?: string | null;
        role?: 'owner' | 'manager' | 'receiver' | 'bookkeeper' | 'chef' | null;
      };
      const t = token as AppJwt;
      if (t.userId && session.user) {
        session.user.id = t.userId;
        session.user.restaurantId = t.restaurantId ?? null;
        session.user.role = t.role ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
