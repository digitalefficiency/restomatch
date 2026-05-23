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
import { db } from './lib/db';

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
  [key: string]: unknown;
}

const adapter = DrizzleAdapter(db, {
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
  session: { strategy: 'jwt' },
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
    async jwt({ token, user }) {
      const t = token as AppJwt;
      if (user?.id) {
        t.userId = user.id;
      }
      // Re-query while we don't have a confirmed membership. Once
      // restaurantId is a real UUID, cache it on the JWT.
      if (t.userId && !t.restaurantId) {
        const membership = await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, t.userId))
          .limit(1);
        if (membership[0]) {
          t.restaurantId = membership[0].restaurantId;
          t.role = membership[0].role;
        } else {
          t.restaurantId = null;
          t.role = null;
        }
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
  const result = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.restaurantId, restaurantId)))
    .limit(1);
  if (!result[0]) return null;
  return { role: result[0].role };
}
