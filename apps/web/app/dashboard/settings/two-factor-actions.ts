'use server';

import { requireFullSession } from '@/lib/authGuards';
import {
  confirmTotpEnrollment,
  disableTwoFactor,
  isTwoFactorEnabled,
  startTotpEnrollment,
  type EnrollmentChallenge,
} from '@/lib/totp';

/**
 * Settings-side 2FA enrollment server actions (Epic C.1). All run on the OWNER
 * auth connection (via lib/totp → authDb) for the signed-in user only.
 *
 * SECURITY: server actions are independent HTTP endpoints dispatched by a global
 * Next-Action id, NOT by route — so the middleware /login/2fa redirect is NOT a
 * boundary for them. Every action here calls requireFullSession() so a
 * twoFactorPending session (an attacker holding only the FIRST factor) is bounced
 * to /login/2fa and can never start / confirm / disable enrollment. The primitive
 * itself is also hardened: startTotpEnrollment refuses to disarm an already-armed
 * 2FA without an explicit disable (which requires the current second factor).
 */

/** Begin enrollment → returns the QR + secret. Does NOT arm 2FA yet. */
export async function startTwoFactorEnrollmentAction(): Promise<EnrollmentChallenge> {
  const { userId, email } = await requireFullSession();
  return startTotpEnrollment(userId, email ?? userId);
}

/** Confirm a code → arms 2FA + returns the one-time recovery codes (shown once). */
export async function confirmTwoFactorEnrollmentAction(
  code: string,
): Promise<{ ok: boolean; recoveryCodes?: string[] }> {
  const { userId } = await requireFullSession();
  const result = await confirmTotpEnrollment(userId, code);
  if (!result) return { ok: false };
  return { ok: true, recoveryCodes: result.recoveryCodes };
}

/** Disable 2FA — requires a CURRENT second factor (TOTP or recovery code). */
export async function disableTwoFactorAction(code: string): Promise<{ ok: boolean }> {
  const { userId } = await requireFullSession();
  return { ok: await disableTwoFactor(userId, code) };
}

/** Current armed state (for optimistic UI refresh). */
export async function twoFactorStatusAction(): Promise<{ enabled: boolean }> {
  const { userId } = await requireFullSession();
  return { enabled: await isTwoFactorEnabled(userId) };
}
