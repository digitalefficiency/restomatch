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
  // Intentionally provider-less AND jwt-callback-less: the Credentials provider
  // (argon2id) and every node-only crypto dep live ONLY in auth.ts. Keeping this
  // edge config provider-less guarantees argon2/otplib never enter the middleware
  // bundle. Consequence: the edge does NOT run a jwt callback, so token_version /
  // absolute-expiry revocation is enforced by the NODE jwt callback in auth.ts
  // (on every request) — middleware only honours the emptied token that callback
  // re-issues (see middleware.ts), it is not an independent revocation check.
  providers: [],
  callbacks: {
    async session({ session, token }) {
      type AppJwt = {
        userId?: string;
        restaurantId?: string | null;
        role?: 'owner' | 'manager' | 'receiver' | 'bookkeeper' | 'chef' | null;
        twoFactorPending?: boolean;
      };
      const t = token as AppJwt;
      if (t.userId && session.user) {
        session.user.id = t.userId;
        session.user.restaurantId = t.restaurantId ?? null;
        session.user.role = t.role ?? null;
        // Exposed to middleware so the edge can enforce the 2FA gate without DB.
        (session.user as { twoFactorPending?: boolean }).twoFactorPending =
          t.twoFactorPending === true;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
