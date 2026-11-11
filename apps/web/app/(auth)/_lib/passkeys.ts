import 'server-only';
import { and, authenticators, eq, inArray, memberships } from '@restomatch/db';
import { authDb } from '@/lib/authDb';

/**
 * W3-07b slice b — passkeys (WebAuthn) for owner and bookkeeper, behind a flag.
 *
 * OFF by default: only `PASSKEYS_ENABLED=1` adds the Auth.js Passkey provider
 * (and its experimental WebAuthn switch) to auth.ts. Credentials live in the
 * existing `authenticators` table via the Drizzle adapter (no schema change).
 * A passkey is accepted — to register or to sign in — only for an account that
 * holds an owner or bookkeeper membership somewhere; everyone else keeps the
 * e-mail + password / code paths. The 2FA gate still applies after a passkey.
 */
export const PASSKEY_ROLES = ['owner', 'bookkeeper'] as const;

/** ON only with PASSKEYS_ENABLED=1 AND a valid AUTH_URL (the WebAuthn relying party is pinned to it). */
export function passkeysEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PASSKEYS_ENABLED === '1' && relyingParty(env) !== null;
}

/** RP id + origin from AUTH_URL — never from the Host / X-Forwarded-Host header (warden review). */
export function relyingParty(env: NodeJS.ProcessEnv = process.env): { id: string; origin: string; name: string } | null {
  try {
    const url = new URL(env.AUTH_URL ?? '');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return { id: url.hostname, origin: url.origin, name: 'RestoMatch' };
  } catch {
    return null;
  }
}

export async function passkeyAllowedFor(userId: string | undefined | null): Promise<boolean> {
  if (!userId) return false;
  const [row] = await authDb
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), inArray(memberships.role, [...PASSKEY_ROLES])))
    .limit(1);
  return Boolean(row);
}

/**
 * The auth.ts signIn callback for provider 'passkey' (warden review, HIGH).
 * Auth.js decides "register" from a session cookie it only DECODES — it never
 * runs our jwt() checks (token_version, sign-out tombstone, expiry, 2FA). So:
 *  - sign-in with a credential already stored for this user → role gate only;
 *  - anything else is a register, and needs a LIVE full session (read through
 *    our own auth(), which runs those checks) for the SAME user, past 2FA.
 * An anonymous register has no user id and fails the role gate.
 */
export async function passkeySignInAllowed(input: {
  userId: string | undefined | null;
  credentialId: string | undefined | null;
  liveSession: () => Promise<{ id?: string | null; twoFactorPending?: boolean } | null>;
}): Promise<boolean> {
  const { userId, credentialId } = input;
  if (!userId || !credentialId) return false;
  if (!(await passkeyAllowedFor(userId))) return false;
  const [known] = await authDb
    .select({ userId: authenticators.userId })
    .from(authenticators)
    .where(eq(authenticators.credentialID, credentialId))
    .limit(1);
  if (known) return known.userId === userId;
  const live = await input.liveSession();
  return Boolean(live?.id) && live!.id === userId && live!.twoFactorPending === false;
}
