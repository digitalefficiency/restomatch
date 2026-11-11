import 'server-only';
import { and, eq, inArray, memberships } from '@restomatch/db';
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

export function passkeysEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PASSKEYS_ENABLED === '1';
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
