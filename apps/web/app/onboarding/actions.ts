'use server';

import { redirect } from 'next/navigation';
import { eq, users } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { requireFullSession } from '@/lib/authGuards';
import { validateOnboarding } from './logic';
import { acceptPendingInvite } from './pendingInvites';

/**
 * Store the signer's own name (auth-27) — invites they send then read
 * "דנה הזמינה אתכם" instead of an anonymous "הוזמנת". Writes ONLY the caller's
 * own users row, on the identity connection (the RLS app role has no UPDATE on
 * users — see packages/db/src/rls.ts). A full session is required: a server
 * action is a public endpoint, so the 2FA gate must live here too.
 */
export async function saveSignerNameAction(rawName: string): Promise<{ ok: boolean }> {
  const { userId } = await requireFullSession();
  const { values, errors } = validateOnboarding({ yourName: String(rawName ?? ''), name: 'xx', businessId: '' });
  if (errors.yourName) return { ok: false };
  await authDb.update(users).set({ name: values.yourName, updatedAt: new Date() }).where(eq(users.id, userId));
  return { ok: true };
}

/**
 * W3-07b: join a team whose invite is waiting for the signed-in address (shown
 * on /onboarding). The invitation id comes from the form, so every guard runs
 * server-side in acceptPendingInvite: pending, unexpired, addressed to THIS
 * user. Then through the session refresh, so the cookie carries the new role.
 */
export async function acceptPendingInviteAction(formData: FormData): Promise<void> {
  const { userId } = await requireFullSession();
  const res = await acceptPendingInvite(userId, String(formData.get('invitationId') ?? ''));
  if (!res.ok) redirect(`/onboarding?invite=${res.reason}`);
  redirect(`/api/session/refresh?next=${encodeURIComponent('/welcome')}`);
}
