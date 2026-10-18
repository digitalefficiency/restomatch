import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Authorization guards for sensitive SERVER ACTIONS.
 *
 * Server actions are independent, globally-addressable HTTP endpoints — Next.js
 * dispatches them by a Next-Action id, NOT by route — so the middleware path
 * redirects (which only ever see the URL the action was POSTed to) are NOT an
 * authorization boundary for them. A `twoFactorPending` attacker holding only a
 * FIRST factor can POST a dashboard action's id to a path the middleware lets a
 * pending session through (e.g. /login, or any public marketing page) and Next
 * will execute it. Therefore every credential-/2FA-mutating action must call
 * requireFullSession() itself, NOT rely on the middleware gate.
 */

export interface FullSession {
  userId: string;
  email: string | null;
}

/**
 * Require a FULLY-authenticated session: signed in AND past the 2FA second
 * factor (twoFactorPending === false). Redirects an anonymous caller to /login
 * and a still-pending caller to /login/2fa, so a pending first-factor session
 * can never reach a sensitive action. Returns the userId + email otherwise.
 */
export async function requireFullSession(): Promise<FullSession> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  // A 2FA-enrolled user who has not yet presented the second factor is confined
  // to the /login/2fa step — they may NOT mutate credentials or 2FA enrollment.
  if (session.user.twoFactorPending) redirect('/login/2fa');
  return { userId, email: session.user.email ?? null };
}
