import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { headers } from 'next/headers';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import { clientIpFromHeaders } from '@restomatch/api';
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
import { authCookieConfig, resolveUseSecureCookies } from './lib/authCookies';
import { authDb } from './lib/authDb';
import { isEmailConfigured, sendEmail } from './lib/email';
import { magicLinkEmail } from './lib/emailTemplates';
import { authorizeCredentials, getSessionSecurityState } from './lib/passwords';
import { consumeTwoFactorTicket } from './lib/totp';
import { enforceLoginLimit, enforceMagicLinkLimit } from './lib/rateLimit';
import {
  SESSION_TTL_LONG_SEC,
  isSessionExpired,
} from './lib/sessionLifetime';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      restaurantId: string | null;
      role: UserRole | null;
      /** 2FA enrolled but the second factor not yet presented (Epic C gate). */
      twoFactorPending: boolean;
    } & DefaultSession['user'];
  }
}

interface AppJwt {
  userId?: string;
  restaurantId?: string | null;
  role?: UserRole | null;
  /** Epoch ms of the last membership re-validation. */
  membershipCheckedAt?: number;
  /** Session-revocation epoch — compared to user_credentials.token_version. */
  ver?: number;
  /** "Remember me" chosen at sign-in (governs the session-lifetime window). */
  rememberMe?: boolean;
  /** Epoch ms of sign-in — anchors the absolute remember-me cap. */
  loginAt?: number;
  /** 2FA enrolled + second factor still pending (Epic C session gate). */
  twoFactorPending?: boolean;
  [key: string]: unknown;
}

/** How long a cached membership/role is trusted before re-querying. */
const MEMBERSHIP_REVALIDATE_MS = 10 * 60 * 1000;

// Pin cookie Secure/HttpOnly/SameSite + name prefixes explicitly instead of
// relying on Auth.js URL auto-detection (D1.3). This REPRODUCES today's defaults
// exactly (no cookie-name change ⇒ no session invalidation) and gives Epic B a
// single place to vary lifetimes from.
const useSecureCookies = resolveUseSecureCookies();

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

  // Dev / preview / no provider: print the link to stdout (and the e2e file
  // hook) so login still works without an email provider. The check-email page
  // tells devs to grep the server log for this banner.
  if (!isEmailConfigured()) {
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

  const { subject, html, text } = magicLinkEmail({ url });
  await sendEmail({ to: identifier, subject, html, text });
}

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  ...authConfig,
  adapter,
  // 30d is the absolute ceiling (the "remember me" window + cookie Max-Age). The
  // ACTUAL per-login lifetime — short (~1d) when remember-me is off, long (~30d)
  // when on — is enforced in the jwt callback (Auth.js v5 has no native
  // per-login maxAge), so a non-remembered session still dies after a day.
  session: { strategy: 'jwt', maxAge: SESSION_TTL_LONG_SEC },
  // Cookie pinning (D1.3): reproduce Auth.js defaults EXACTLY (byte-identical
  // names) so live magic-link sessions are NOT invalidated. The cookies block
  // sets only flags/names (no Max-Age), so session.maxAge above still governs
  // the cookie lifetime ceiling.
  useSecureCookies,
  cookies: authCookieConfig(useSecureCookies),
  providers: [
    // Password (argon2id) — PRIMARY. Lives ONLY here (node runtime): argon2 must
    // never enter the edge bundle (auth.config.ts / middleware stay
    // provider-less). authorize() returns a UNIFORM null for every failure mode.
    Credentials({
      // `rememberMe` rides along so the jwt callback can size the session.
      credentials: { email: {}, password: {}, rememberMe: {} },
      authorize: async (creds) => {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        // Throttle HERE — not only in the /login page server action (B.5 / C.2).
        // Auth.js exposes the credentials flow at POST /api/auth/callback/
        // credentials, which middleware leaves public; a script can fetch a CSRF
        // token and POST straight to it, skipping the page action entirely. So
        // the email+IP login limit must run INSIDE authorize() to be
        // un-bypassable. Reads the client IP from the request headers. Fails OPEN
        // on a Redis outage — the durable floor is the per-account DB lockout in
        // authorizeCredentials. A rate-limited attempt returns the same uniform
        // null as a wrong password (surfaced as CredentialsSignin), revealing no
        // account/lock state.
        const ip = clientIpFromHeaders(await headers());
        const rl = await enforceLoginLimit(email, ip);
        if (!rl.allowed) return null;
        const result = await authorizeCredentials({ email, password });
        if (!result) return null;
        const rememberMe =
          creds?.rememberMe === true ||
          creds?.rememberMe === 'true' ||
          creds?.rememberMe === 'on';
        // Extra fields are carried into jwt() as `user` on first sign-in.
        return {
          id: result.id,
          email: result.email,
          name: result.name,
          rememberMe,
          twoFactorPending: result.twoFactorPending,
        } as unknown as { id: string };
      },
    }),
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
    async jwt({ token, user, trigger, session }) {
      const t = token as AppJwt;
      const now = Date.now();
      const signInId = user?.id;
      const isSignIn = Boolean(signInId);

      // Second-factor clearance (Epic C). The /login/2fa step verifies a TOTP /
      // recovery code SERVER-SIDE, mints a one-time DB ticket, and triggers this
      // update with the raw nonce. We re-validate the nonce against the stored
      // hash here (NOT a client-supplied boolean) — so a hand-crafted POST to
      // the session-update endpoint cannot clear the gate without a real factor.
      if (trigger === 'update' && t.userId) {
        const ticket = (session as { twoFactorTicket?: unknown } | undefined)?.twoFactorTicket;
        if (typeof ticket === 'string' && ticket) {
          if (await consumeTwoFactorTicket(t.userId, ticket)) {
            t.twoFactorPending = false;
          }
        }
      }

      if (signInId) {
        t.userId = signInId;
        t.loginAt = now;
        const u = user as { rememberMe?: boolean; twoFactorPending?: boolean };
        // Password logins carry an explicit remember-me boolean from the form.
        // Magic-link logins (the adapter user has no such field) default to the
        // LONG window so existing magic-link users are NOT regressed to a 1d
        // session — email possession is already a strong factor.
        const isCredentialsLogin = typeof u.rememberMe === 'boolean';
        t.rememberMe = isCredentialsLogin ? u.rememberMe === true : true;
        // Stamp the session-revocation epoch + 2FA gate at sign-in. For the
        // Credentials provider authorize() already told us twoFactorPending; for
        // magic-link we read it from the DB — so a magic-link FIRST factor STILL
        // leaves a 2FA-enrolled user pending the second factor (Epic C gate).
        const sec = await getSessionSecurityState(signInId);
        t.ver = sec.tokenVersion;
        t.twoFactorPending = (u.twoFactorPending ?? false) || sec.twoFactorEnabled;
      }
      if (!t.userId) return t;

      // "Remember me" lifetime (B.5): enforce the absolute window from loginAt
      // ourselves — a non-remembered session expires after ~1d, remembered ~30d.
      // Runs EVERY request (unconditionally), like the revocation check below.
      if (t.loginAt !== undefined && isSessionExpired(t.loginAt, t.rememberMe === true, now)) {
        return {} as AppJwt; // expired ⇒ unauthenticated on the next request
      }

      // Session revocation (B.2): re-read token_version on EVERY request for an
      // already-authenticated token (skipped only on the very first sign-in,
      // where t.ver was just stamped above). This is deliberately OUTSIDE the
      // membership-revalidation cache below: bumping token_version (reset /
      // change-password / "log out everywhere") must reject a stale/stolen cookie
      // on the very NEXT request — not only when the 10-minute membership window
      // happens to be stale. It is a single indexed PK lookup on user_credentials,
      // mirroring the unconditional loginAt-expiry check directly above. The node
      // jwt callback is the authoritative per-request revocation gate (middleware
      // only honours the emptied token it re-issues — see middleware.ts).
      if (!isSignIn) {
        const sec = await getSessionSecurityState(t.userId);
        if ((t.ver ?? 0) !== sec.tokenVersion) {
          return {} as AppJwt; // revoked ⇒ unauthenticated
        }
      }

      // Re-validate membership/role periodically (and on first sight / explicit
      // update) so a revoked membership or demoted role stops granting access
      // within MEMBERSHIP_REVALIDATE_MS instead of for the whole JWT lifetime.
      // NOTE: this caches membership/role ONLY — the revocation check above is
      // intentionally NOT gated by this window.
      const stale =
        t.membershipCheckedAt === undefined ||
        now - t.membershipCheckedAt > MEMBERSHIP_REVALIDATE_MS ||
        // A user with no active restaurant is re-checked on EVERY request (one
        // indexed membership query) until they have one. This makes a freshly
        // onboarded owner / a just-accepted invitee visible on the very next
        // request instead of being bounced from /dashboard, /team and /settings
        // for up to MEMBERSHIP_REVALIDATE_MS. Users who already have a restaurant
        // keep the cached revalidation window.
        t.restaurantId == null;
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
        session.user.twoFactorPending = t.twoFactorPending === true;
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
