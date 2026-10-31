'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFromHeaders } from '@restomatch/api';
import { auth, signOut, unstable_update } from '@/auth';
import { getUserEmailById } from '@/lib/passwords';
import { enforceTwoFactorLimit, trustedProxyHops } from '@/lib/rateLimit';
import { safeRelativePath } from '@/lib/safeRedirect';
import { issueTwoFactorTicket, verifySecondFactor } from '@/lib/totp';
import { clearHint } from '../hint';

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
  // Validated same-origin destination (open-redirect guard) — e.g. an invite link.
  const next = safeRelativePath(formData.get('callbackUrl'));
  if (!session.user.twoFactorPending) redirect(next);
  // A failed recovery code comes back to the recovery (text-keyboard) mode.
  const mode = formData.get('mode') === 'recovery' ? '&mode=recovery' : '';
  const retry = `/login/2fa?error=invalid&callbackUrl=${encodeURIComponent(next)}${mode}`;

  const code = String(formData.get('code') ?? '').trim();
  if (!code) redirect(retry);

  const ip = clientIpFromHeaders(await headers(), { trustedProxyHops: trustedProxyHops() });
  const email = (await getUserEmailById(userId)) ?? userId;
  const rl = await enforceTwoFactorLimit(email, ip);
  if (!rl.allowed) redirect(retry);

  const status = await verifySecondFactor(userId, code);
  if (status !== 'ok') {
    // Uniform: 'locked' and 'invalid' are indistinguishable to the caller.
    redirect(retry);
  }

  // Verified server-side → mint the pass ticket and clear the gate via the JWT.
  const nonce = await issueTwoFactorTicket(userId);
  await unstable_update({ twoFactorTicket: nonce } as unknown as Parameters<typeof unstable_update>[0]);
  redirect(next);
}

/** Abandon the second step and return to a clean login. */
export async function cancelTwoFactorAction(): Promise<void> {
  await clearHint();
  await signOut({ redirectTo: '/login' });
}
