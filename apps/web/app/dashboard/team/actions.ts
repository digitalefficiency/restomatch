'use server';

import { revalidatePath } from 'next/cache';
import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import type { RateLimitOptions } from '@restomatch/api';
import { enforceRateLimit } from '@/lib/rateLimit';
import { createServerCaller } from '@/lib/trpc/server';
import { isEmailConfigured, sendEmail } from '@/lib/email';
import { inviteEmail } from '@/lib/emailTemplates';
import type { Locale } from '@/lib/i18n/config';
import { team } from '@/lib/i18n/messages/team';
import { getLocale, getT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/translate';
import { labelForRole } from '@/lib/roles';
import { localizeServerError } from '@/lib/serverErrors';

interface ActionResult {
  ok: boolean;
  message: string;
  /** In dev/preview (no email provider) we surface the link so it's testable. */
  devLink?: string;
}

/**
 * Invite/resend emails go to arbitrary mailboxes, so a compromised (or hostile)
 * owner account could be used as a spam relay. Cap outbound invite emails per
 * inviter. Fails open on a rate-limit store outage, like every other limiter.
 */
const INVITE_EMAIL_LIMIT: RateLimitOptions = { limit: 20, windowSec: 60 * 60 };

async function inviteAllowed(): Promise<boolean> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return true; // the tRPC owner gate rejects it anyway
  return (await enforceRateLimit(`invite:${userId}`, INVITE_EMAIL_LIMIT)).allowed;
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? process.env.APP_URL ?? '';
}

/**
 * The invite link routes through /login so an unauthenticated invitee signs in
 * (magic link) first, then NextAuth redirects to the accept page WITH the token
 * intact in callbackUrl (middleware's redirect would otherwise drop the query).
 * An English invitee also gets `lang=en`, so the login page (and the magic-link
 * email it sends) is already in English.
 */
function inviteLink(rawToken: string, email: string, locale: Locale | null): string {
  const callbackUrl = `/invite/accept?token=${encodeURIComponent(rawToken)}`;
  const params = new URLSearchParams({ callbackUrl, email });
  if (locale) params.set('lang', locale);
  return `${baseUrl()}/login?${params.toString()}`;
}

async function deliverInvite(res: {
  rawToken: string;
  email: string;
  role: UserRole;
  restaurantName: string;
  inviterName: string | null;
  locale: Locale | null;
}): Promise<string> {
  const url = inviteLink(res.rawToken, res.email, res.locale);
  const lang = res.locale ?? 'he';
  const { subject, html, text } = inviteEmail({
    url,
    restaurantName: res.restaurantName,
    roleLabel: labelForRole(res.role, lang),
    inviterName: res.inviterName,
    locale: lang,
  });
  await sendEmail({ to: res.email, subject, html, text });
  if (!isEmailConfigured()) {
    // Dev/preview: print the link (like the reset flow) so it is testable.
    console.log('\n──────── INVITE LINK ────────');
    console.log(`to: ${res.email}`);
    console.log(`url: ${url}`);
    console.log('─────────────────────────────\n');
  }
  return url;
}

async function fail(e: unknown, fallbackKey: MessageKey<typeof team.he>): Promise<ActionResult> {
  const t = await getT(team);
  return { ok: false, message: localizeServerError(e, await getLocale(), t(fallbackKey)) };
}

export async function inviteMember(input: {
  email: string;
  role: UserRole;
  locale?: Locale | null;
}): Promise<ActionResult> {
  if (!(await inviteAllowed())) {
    return { ok: false, message: (await getT(team))('invite.rateLimited') };
  }
  try {
    const caller = await createServerCaller();
    const res = await caller.team.invite({
      email: input.email,
      role: input.role,
      ...(input.locale ? { locale: input.locale } : {}),
    });
    const url = await deliverInvite(res);
    revalidatePath('/dashboard/team');
    const t = await getT(team);
    return {
      ok: true,
      message: t('invite.sent', { email: res.email }),
      devLink: isEmailConfigured() ? undefined : url,
    };
  } catch (e) {
    return fail(e, 'invite.failed');
  }
}

export async function resendInvite(input: { id: string }): Promise<ActionResult> {
  if (!(await inviteAllowed())) {
    return { ok: false, message: (await getT(team))('invite.rateLimited') };
  }
  try {
    const caller = await createServerCaller();
    const res = await caller.team.resendInvite(input);
    const url = await deliverInvite(res);
    revalidatePath('/dashboard/team');
    const t = await getT(team);
    return {
      ok: true,
      message: t('invite.resent', { email: res.email }),
      devLink: isEmailConfigured() ? undefined : url,
    };
  } catch (e) {
    return fail(e, 'invite.resendFailed');
  }
}

export async function revokeInvite(input: { id: string }): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.revokeInvite(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: (await getT(team))('invite.revoked') };
  } catch (e) {
    return fail(e, 'invite.revokeFailed');
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
    return { ok: true, message: (await getT(team))('members.roleUpdated') };
  } catch (e) {
    return fail(e, 'members.roleFailed');
  }
}

export async function removeMember(input: { userId: string }): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.removeMember(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: (await getT(team))('members.removed') };
  } catch (e) {
    return fail(e, 'members.removeFailed');
  }
}

/** Owner/manager sets a member's app language (null = follow the device). */
export async function setMemberLocale(input: {
  userId: string;
  email: string;
  locale: Locale | null;
}): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.setMemberLocale({ userId: input.userId, locale: input.locale });
    revalidatePath('/dashboard/team');
    return { ok: true, message: (await getT(team))('members.localeUpdated', { email: input.email }) };
  } catch (e) {
    return fail(e, 'members.localeFailed');
  }
}
