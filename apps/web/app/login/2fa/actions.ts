'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFromHeaders } from '@restomatch/api';
import { auth, signOut, unstable_update } from '@/auth';
import { getUserEmailById } from '@/lib/passwords';
import { enforceTwoFactorLimit, trustedProxyHops } from '@/lib/rateLimit';
import { issueTwoFactorTicket, verifySecondFactor } from '@/lib/totp';

/**
 * Second-factor verification (Epic C). Runs ONLY for a session that already
 * passed the first factor (password OR magic-link) and is still twoFactorPending
 * — the session-layer gate, so magic-link logins are covered too.
 *
 * On success it mints a one-time DB ticket and hands the raw nonce to the
 * Auth.js session update; the jwt callback re-validates the nonce server-side
 * before clearing the pending flag (a client cannot forge it). Throttled on
 * email AND IP, with the durable DB lockout backstop inside verifySecondFactor.
 * Every failure (wrong code, locked, rate-limited) surfaces ONE uniform message.
 */
export async function verifyTwoFactorAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');
  // Not pending → nothing to verify (already past the gate).
  if (!session.user.twoFactorPending) redirect('/dashboard');

  const code = String(formData.get('code') ?? '').trim();
  if (!code) redirect('/login/2fa?error=invalid');

  const ip = clientIpFromHeaders(await headers(), { trustedProxyHops: trustedProxyHops() });
  const email = (await getUserEmailById(userId)) ?? userId;
  const rl = await enforceTwoFactorLimit(email, ip);
  if (!rl.allowed) redirect('/login/2fa?error=invalid');

  const status = await verifySecondFactor(userId, code);
  if (status !== 'ok') {
    // Uniform: 'locked' and 'invalid' are indistinguishable to the caller.
    redirect('/login/2fa?error=invalid');
  }

  // Verified server-side → mint the pass ticket and clear the gate via the JWT.
  const nonce = await issueTwoFactorTicket(userId);
  await unstable_update({ twoFactorTicket: nonce } as unknown as Parameters<typeof unstable_update>[0]);
  redirect('/dashboard');
}

/** Abandon the second step and return to a clean login. */
export async function cancelTwoFactorAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
