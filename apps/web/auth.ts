import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type DefaultSession } from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import {
  accounts,
  and,
  authenticators,
  eq,
  memberships,
  sessions,
  users,
  verificationTokens,
  type UserRole,
} from '@restomatch/db';
import { authConfig } from './auth.config';
import { authDb } from './lib/authDb';
import { enforceMagicLinkLimit } from './lib/rateLimit';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      restaurantId: string | null;
      role: UserRole | null;
    } & DefaultSession['user'];
  }
}

interface AppJwt {
  userId?: string;
  restaurantId?: string | null;
  role?: UserRole | null;
  /** Epoch ms of the last membership re-validation. */
  membershipCheckedAt?: number;
  [key: string]: unknown;
}

/** How long a cached membership/role is trusted before re-querying. */
const MEMBERSHIP_REVALIDATE_MS = 10 * 60 * 1000;

const adapter = DrizzleAdapter(authDb, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
  authenticatorsTable: authenticators,
});

async function sendMagicLink({
  identifier,
  url,
}: {
  identifier: string;
  url: string;
}): Promise<void> {
  // Throttle per destination mailbox (collapsing +tag / dot aliases): blocks
  // magic-link bombing / address probing. Fails open on a Redis outage so login
  // stays available.
  const rl = await enforceMagicLinkLimit(identifier);
  if (!rl.allowed) {
    throw new Error(
      `יותר מדי בקשות התחברות לכתובת הזו. נסו שוב בעוד ${Math.ceil(rl.resetSec / 60)} דקות.`,
    );
  }

  if (process.env.NODE_ENV !== 'production' || !process.env.EMAIL_FROM) {
    console.log('\n──────── MAGIC LINK ────────');
    console.log(`to: ${identifier}`);
    console.log(`url: ${url}`);
    console.log('────────────────────────────\n');
    if (process.env.MAGIC_LINK_FILE) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        process.env.MAGIC_LINK_FILE,
        JSON.stringify({ identifier, url, at: Date.now() }),
        'utf8',
      );
    }
    return;
  }
  throw new Error('production email sending not configured yet');
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter,
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Nodemailer({
      from: process.env.EMAIL_FROM ?? 'auth@restomatch.local',
      server: {
        host: 'localhost',
        port: 1025,
        auth: { user: 'dev', pass: 'dev' },
      },
      sendVerificationRequest: sendMagicLink,
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      const t = token as AppJwt;
      if (user?.id) {
        t.userId = user.id;
      }
      if (!t.userId) return t;

      // Re-validate membership + role periodically (and on first sight / on an
      // explicit session update) so a revoked membership or a demoted role
      // stops granting access within MEMBERSHIP_REVALIDATE_MS instead of
      // surviving for the whole JWT lifetime.
      const now = Date.now();
      const stale =
        t.membershipCheckedAt === undefined ||
        now - t.membershipCheckedAt > MEMBERSHIP_REVALIDATE_MS;
      if (stale || trigger === 'update') {
        const userId = t.userId;
        // Identity-layer read on the privileged auth connection (it must see
        // the user's memberships across tenants to pick the active one).
        const rows = await authDb
          .select()
          .from(memberships)
          .where(eq(memberships.userId, userId));
        // Keep the active restaurant if its membership still exists (and pick
        // up any role change); otherwise fall back to any membership, else none.
        const active = t.restaurantId
          ? rows.find((m) => m.restaurantId === t.restaurantId)
          : undefined;
        const chosen = active ?? rows[0];
        if (chosen) {
          t.restaurantId = chosen.restaurantId;
          t.role = chosen.role;
        } else {
          t.restaurantId = null;
          t.role = null;
        }
        t.membershipCheckedAt = now;
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as AppJwt;
      if (t.userId && session.user) {
        session.user.id = t.userId;
        session.user.restaurantId = t.restaurantId ?? null;
        session.user.role = t.role ?? null;
      }
      return session;
    },
  },
});

/**
 * Switch the user's active restaurant if they have multiple memberships.
 * Re-issues JWT with new restaurantId on next request via session refresh.
 */
export async function switchActiveRestaurant(
  userId: string,
  restaurantId: string,
): Promise<{ role: UserRole } | null> {
  const result = await authDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.restaurantId, restaurantId)))
    .limit(1);
  if (!result[0]) return null;
  return { role: result[0].role };
}
