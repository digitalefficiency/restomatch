'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpFromHeaders } from '@restomatch/api';
import { auth, signOut } from '@/auth';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { passwordResetEmail } from '@/lib/emailTemplates';
import { passwordPolicyError } from '@/lib/passwordPolicy';
import {
  bumpTokenVersion,
  changeUserPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  setUserPassword,
} from '@/lib/passwords';
import { enforcePasswordResetLimit } from '@/lib/rateLimit';

/** Absolute base URL for emailed links (prefers explicit env, else the request host). */
async function baseUrl(): Promise<string> {
  const fromEnv = process.env.APP_URL ?? process.env.AUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

/**
 * Request a password-reset link. Rate-limited per-mailbox AND per-IP. ALWAYS
 * redirects to the same "check your email" state regardless of whether the
 * address exists — no account enumeration.
 */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/reset?sent=1');

  const h = await headers();
  const ip = clientIpFromHeaders(h);
  const rl = await enforcePasswordResetLimit(email, ip);
  if (!rl.allowed) {
    redirect(`/reset?error=rate&wait=${Math.ceil(rl.resetSec / 60)}`);
  }

  const result = await requestPasswordReset(email);
  if (result) {
    const url = `${await baseUrl()}/reset?token=${encodeURIComponent(result.rawToken)}`;
    const { subject, html, text } = passwordResetEmail({ url });
    if (isEmailConfigured()) {
      await sendEmail({ to: email, subject, html, text });
    } else {
      // Dev/preview/tests: print so the flow works without an email provider.
      console.log('\n──────── PASSWORD RESET LINK ────────');
      console.log(`to: ${email}`);
      console.log(`url: ${url}`);
      console.log('─────────────────────────────────────\n');
    }
  }
  redirect('/reset?sent=1');
}

/**
 * Consume a reset token and set the new password. resetPasswordWithToken bumps
 * tokenVersion (revoking every live session). Uniform handling for an invalid /
 * used / expired token.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const back = `/reset?token=${encodeURIComponent(token)}`;

  if (password !== confirm) redirect(`${back}&error=mismatch`);
  const policy = passwordPolicyError(password);
  if (policy) redirect(`${back}&error=policy`);

  const ok = await resetPasswordWithToken(token, password);
  if (!ok) redirect(`${back}&error=token`);
  redirect('/login?reset=1');
}

/**
 * First-time set-password for a magic-link-verified user (must be signed in).
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) redirect('/set-password?error=mismatch');
  const policy = passwordPolicyError(password);
  if (policy) redirect('/set-password?error=policy');
  await setUserPassword(session.user.id, password);
  redirect('/dashboard?password=set');
}

/**
 * Change password (verifies the current one) and bump tokenVersion so other
 * devices are logged out. Must be signed in.
 */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const current = String(formData.get('current') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) redirect('/set-password?error=mismatch');
  const policy = passwordPolicyError(password);
  if (policy) redirect('/set-password?error=policy');
  const ok = await changeUserPassword(session.user.id, current, password);
  if (!ok) redirect('/set-password?error=current');
  redirect('/set-password?changed=1');
}

/**
 * "Log out everywhere": bump tokenVersion (revokes every live JWT on its next
 * revalidation) then end this device's session too.
 */
export async function logOutEverywhereAction(): Promise<void> {
  const session = await auth();
  if (session?.user?.id) {
    await bumpTokenVersion(session.user.id);
  }
  await signOut({ redirectTo: '/login' });
}
