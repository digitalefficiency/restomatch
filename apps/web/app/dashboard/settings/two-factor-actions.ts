'use server';

import { auth } from '@/auth';
import {
  confirmTotpEnrollment,
  disableTwoFactor,
  isTwoFactorEnabled,
  startTotpEnrollment,
  type EnrollmentChallenge,
} from '@/lib/totp';

/**
 * Settings-side 2FA enrollment server actions (Epic C.1). All run on the OWNER
 * auth connection (via lib/totp → authDb) for the signed-in user only. A
 * twoFactorPending session can never reach here — the middleware gate bounces it
 * to /login/2fa before any dashboard route renders.
 */

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('unauthenticated');
  return userId;
}

/** Begin enrollment → returns the QR + secret. Does NOT arm 2FA yet. */
export async function startTwoFactorEnrollmentAction(): Promise<EnrollmentChallenge> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('unauthenticated');
  const label = session.user.email ?? userId;
  return startTotpEnrollment(userId, label);
}

/** Confirm a code → arms 2FA + returns the one-time recovery codes (shown once). */
export async function confirmTwoFactorEnrollmentAction(
  code: string,
): Promise<{ ok: boolean; recoveryCodes?: string[] }> {
  const userId = await requireUserId();
  const result = await confirmTotpEnrollment(userId, code);
  if (!result) return { ok: false };
  return { ok: true, recoveryCodes: result.recoveryCodes };
}

/** Disable 2FA — requires a CURRENT second factor (TOTP or recovery code). */
export async function disableTwoFactorAction(code: string): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  return { ok: await disableTwoFactor(userId, code) };
}

/** Current armed state (for optimistic UI refresh). */
export async function twoFactorStatusAction(): Promise<{ enabled: boolean }> {
  const userId = await requireUserId();
  return { enabled: await isTwoFactorEnabled(userId) };
}
