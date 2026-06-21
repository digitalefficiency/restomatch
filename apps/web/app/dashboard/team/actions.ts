'use server';

import { revalidatePath } from 'next/cache';
import type { UserRole } from '@restomatch/db';
import { createServerCaller } from '@/lib/trpc/server';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { inviteEmail } from '@/lib/emailTemplates';
import { labelForRole } from '@/lib/roles';

interface ActionResult {
  ok: boolean;
  message: string;
  /** In dev/preview (no email provider) we surface the link so it's testable. */
  devLink?: string;
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? process.env.APP_URL ?? '';
}

/**
 * The invite link routes through /login so an unauthenticated invitee signs in
 * (magic link) first, then NextAuth redirects to the accept page WITH the token
 * intact in callbackUrl (middleware's redirect would otherwise drop the query).
 */
function inviteLink(rawToken: string, email: string): string {
  const callbackUrl = `/invite/accept?token=${encodeURIComponent(rawToken)}`;
  const params = new URLSearchParams({ callbackUrl, email });
  return `${baseUrl()}/login?${params.toString()}`;
}

async function deliverInvite(res: {
  rawToken: string;
  email: string;
  role: UserRole;
  restaurantName: string;
  inviterName: string | null;
}): Promise<string> {
  const url = inviteLink(res.rawToken, res.email);
  const { subject, html, text } = inviteEmail({
    url,
    restaurantName: res.restaurantName,
    roleLabel: labelForRole(res.role),
    inviterName: res.inviterName,
  });
  await sendEmail({ to: res.email, subject, html, text });
  return url;
}

export async function inviteMember(input: {
  email: string;
  role: UserRole;
}): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    const res = await caller.team.invite(input);
    const url = await deliverInvite(res);
    revalidatePath('/dashboard/team');
    return {
      ok: true,
      message: `הזמנה נשלחה ל-${res.email}.`,
      devLink: isEmailConfigured() ? undefined : url,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'שליחת ההזמנה נכשלה.' };
  }
}

export async function resendInvite(input: { id: string }): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    const res = await caller.team.resendInvite(input);
    const url = await deliverInvite(res);
    revalidatePath('/dashboard/team');
    return {
      ok: true,
      message: `הזמנה נשלחה שוב ל-${res.email}.`,
      devLink: isEmailConfigured() ? undefined : url,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'שליחה חוזרת נכשלה.' };
  }
}

export async function revokeInvite(input: { id: string }): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.revokeInvite(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: 'ההזמנה בוטלה.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'ביטול ההזמנה נכשל.' };
  }
}

export async function updateMemberRole(input: {
  userId: string;
  role: UserRole;
}): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.updateMemberRole(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: 'התפקיד עודכן.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'עדכון התפקיד נכשל.' };
  }
}

export async function removeMember(input: { userId: string }): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.removeMember(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: 'החבר הוסר מהצוות.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'הסרת החבר נכשלה.' };
  }
}
