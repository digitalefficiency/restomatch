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

/**
 * Open items that must land before passkeys may be switched on (security
 * review of #309, M3/M4). While this list is not empty, PASSKEYS_ENABLED=1
 * makes the app REFUSE TO START (assertPasskeysConfig, called from auth.ts).
 */
export const PASSKEY_BLOCKERS: readonly string[] = [
  // Each entry names the attack test that must pass before it may be removed.
  'M3: password reset / "log out everywhere" delete authenticators + passkey accounts — test: register, reset password (or bump token_version), passkey sign-in refused',
  'M4: /passkeys list + remove (requireFullSession), step-up before register (loginAt ≤ 5 min or password/code), "new passkey added" e-mail — test: register without step-up refused; removed credential cannot sign in',
  'L1: stateless challenge cookie (replay window) — test: a replayed register/authenticate response is refused',
  'L2: every passkey sign-in/register gets the 30-day session, ignoring remember-me — test: passkey session follows the remember-me window',
  'L3: attack tests mock the auth.ts wiring — test: an integration test drives /api/auth/webauthn-options + callback',
  'L4: DSR erasure leaves authenticators rows — test: erasure deletes the user\'s authenticators',
];

/** ON only with PASSKEYS_ENABLED=1, a valid AUTH_URL, and no open blockers. */
export function passkeysEnabled(
  env: NodeJS.ProcessEnv = process.env,
  blockers: readonly string[] = PASSKEY_BLOCKERS,
): boolean {
  return env.PASSKEYS_ENABLED === '1' && relyingParty(env) !== null && blockers.length === 0;
}

/** Boot guard: asking for passkeys while blockers are open (or AUTH_URL is bad) stops the app. */
export function assertPasskeysConfig(
  env: NodeJS.ProcessEnv = process.env,
  blockers: readonly string[] = PASSKEY_BLOCKERS,
): void {
  if (env.PASSKEYS_ENABLED !== '1') return;
  if (blockers.length > 0) {
    throw new Error(`[passkeys] PASSKEYS_ENABLED=1 refused — open blockers:\n- ${blockers.join('\n- ')}`);
  }
  if (relyingParty(env) === null) throw new Error('[passkeys] PASSKEYS_ENABLED=1 needs an https AUTH_URL');
}

/**
 * Passkey getUserInfo (security review M2). Auth.js calls it only WITHOUT a
 * session; the default reads `?email=` and returns that account's credential
 * ids to anyone — an account-enumeration oracle. Ours ignores the request
 * entirely: anonymous visitors get discoverable-credential sign-in only, and
 * registration needs a session (Auth.js then uses the session user instead).
 */
export async function passkeyGetUserInfo(): Promise<null> {
  return null;
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
