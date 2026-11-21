'use server';

import QRCode from 'qrcode';
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
import { isPublicPath } from '@/lib/publicPaths';
import { localizeServerError } from '@/lib/serverErrors';

interface ActionResult {
  ok: boolean;
  message: string;
  /**
   * W3-07b: the `/join/<token>` link, so the owner can also send it by WhatsApp
   * or copy it (the e-mail goes out either way). Only the inviting owner sees it.
   */
  shareLink?: string;
  /** Ready-to-send WhatsApp text (restaurant + link). */
  shareText?: string;
  /** The join link as a QR (PNG data URL) — the worker scans it on the owner's screen. */
  shareQr?: string;
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
 * W3-07b: the invite link is the public `/join/<token>` page (restaurant, role,
 * inviter, then an e-mail code and the invitee's own password). An English
 * invitee also gets `lang=en`, so the page and the code e-mail are in English.
 */
function inviteLink(rawToken: string, email: string, locale: Locale | null): string {
  if (isPublicPath('/join/x')) {
    const qs = locale ? `?lang=${locale}` : '';
    return `${baseUrl()}/join/${encodeURIComponent(rawToken)}${qs}`;
  }
  // Interim until the '/join' publicPaths line is in (orchestrator): the
  // signed-in accept route through /login, as before W3-07b.
  const params = new URLSearchParams({ callbackUrl: `/invite/accept?token=${encodeURIComponent(rawToken)}`, email });
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
      shareLink: url,
      shareText: t('invite.whatsappText', { restaurant: res.restaurantName, url }),
      shareQr: await QRCode.toDataURL(url, { margin: 1, width: 320 }),
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
      shareLink: url,
      shareText: t('invite.whatsappText', { restaurant: res.restaurantName, url }),
      shareQr: await QRCode.toDataURL(url, { margin: 1, width: 320 }),
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
  /** The role the change was staged from; a stale one → CONFLICT. */
  expectedRole?: UserRole;
}): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.updateMemberRole(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: (await getT(team))('members.roleUpdated') };
  } catch (e) {
    // Stale staged change: the server message names who changed it (Hebrew).
    const code = (e as { code?: string }).code;
    if (code === 'CONFLICT') {
      revalidatePath('/dashboard/team');
      const locale = await getLocale();
      return {
        ok: false,
        message: locale === 'he' && e instanceof Error ? e.message : (await getT(team))('members.roleConflict'),
      };
    }
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

/** Hand the restaurant to another member (W2-14). Owner only; audited server-side. */
export async function transferOwnership(input: {
  toUserId: string;
  myNewRole: 'owner' | 'manager' | 'bookkeeper';
}): Promise<ActionResult> {
  try {
    const caller = await createServerCaller();
    await caller.team.transferOwnership(input);
    revalidatePath('/dashboard/team');
    return { ok: true, message: (await getT(team))('transfer.done') };
  } catch (e) {
    return fail(e, 'transfer.failed');
  }
}
