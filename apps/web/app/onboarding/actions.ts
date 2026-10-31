'use server';

import { eq, users } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { requireFullSession } from '@/lib/authGuards';
import { validateOnboarding } from './logic';

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
