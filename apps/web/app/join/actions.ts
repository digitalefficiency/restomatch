'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { clientIpFromHeaders, type RateLimitOptions } from '@restomatch/api';
import { signIn } from '@/auth';
import { enforceRateLimit, trustedProxyHops } from '@/lib/rateLimit';
import { deliverJoinCode, deliverJoinSignInLink } from './_lib/codeEmail';
import {
  completeJoin,
  hashInviteToken,
  issueJoinCode,
  joinContact,
  loadInvite,
  plausibleToken,
  publicCompleteReason,
} from './_lib/joinFlow';
import { joinAcceptPath } from './paths';

/**
 * W3-07b public join actions. The limiter (lib/rateLimit, consumed — never
 * edited) is the soft layer and fails open; the durable ceilings live in
 * joinFlow (attempt markers), so a store outage never removes them.
 */
const SEND_PER_INVITE: RateLimitOptions = { limit: 3, windowSec: 15 * 60, prefix: 'join-send' };
const SEND_PER_IP: RateLimitOptions = { limit: 10, windowSec: 15 * 60, prefix: 'join-send-ip' };
const VERIFY_PER_IP: RateLimitOptions = { limit: 20, windowSec: 15 * 60, prefix: 'join-verify-ip' };

async function requestIp(): Promise<string> {
  return clientIpFromHeaders(await headers(), { trustedProxyHops: trustedProxyHops() });
}

function tokenOf(formData: FormData): string {
  const token = String(formData.get('token') ?? '');
  if (!plausibleToken(token)) redirect('/join/invalid');
  return token;
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? process.env.APP_URL ?? '';
}

function back(token: string, params: Record<string, string>): never {
  redirect(`/join/${token}?${new URLSearchParams(params).toString()}`);
}

export async function sendJoinCodeAction(formData: FormData): Promise<void> {
  const token = tokenOf(formData);
  const ip = await requestIp();
  const perInvite = await enforceRateLimit(hashInviteToken(token).slice(0, 32), SEND_PER_INVITE);
  const perIp = await enforceRateLimit(ip, SEND_PER_IP);
  if (!perInvite.allowed || !perIp.allowed) back(token, { step: 'code', e: 'rate' });

  const res = await issueJoinCode(token);
  if (!res.ok && res.reason === 'hasPassword') {
    // An existing account: e-mail a sign-in link (no code, no password set) and
    // answer EXACTLY like the code path, so /join is no account oracle.
    if (res.throttled) back(token, { step: 'code', e: 'rate' });
    const contact = await joinContact(token);
    if (contact) {
      await deliverJoinSignInLink({
        to: contact.email,
        url: `${baseUrl()}/login?${new URLSearchParams({ callbackUrl: joinAcceptPath(token) }).toString()}`,
        restaurantName: contact.restaurantName,
        locale: contact.locale,
      });
    }
    back(token, { step: 'code', sent: '1' });
  }
  if (!res.ok) back(token, res.reason === 'rate' ? { step: 'code', e: 'rate' } : { e: res.reason });
  const invite = await loadInvite(token);
  await deliverJoinCode({ to: res.email, code: res.code, restaurantName: invite.restaurantName, locale: res.locale ?? 'he' });
  back(token, { step: 'code', sent: '1' });
}

export async function completeJoinAction(formData: FormData): Promise<void> {
  const token = tokenOf(formData);
  const ip = await requestIp();
  if (!(await enforceRateLimit(ip, VERIFY_PER_IP)).allowed) back(token, { step: 'code', e: 'rate' });

  const password = String(formData.get('password') ?? '');
  const res = await completeJoin({
    token,
    code: String(formData.get('code') ?? ''),
    name: formData.get('name'),
    password,
  });
  // "No live code" and "already has an account" both read as a wrong code (no oracle).
  if (!res.ok) back(token, { step: 'code', e: publicCompleteReason(res.reason) });

  const remember = formData.get('rememberMe') === 'on';
  try {
    // The existing Credentials provider (its own limiter + lockout + 2FA gate),
    // then team.acceptInvite writes the membership and the audit row.
    await signIn('credentials', {
      email: res.email,
      password,
      rememberMe: remember ? 'true' : 'false',
      redirectTo: joinAcceptPath(token),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect(`/login?${new URLSearchParams({ callbackUrl: joinAcceptPath(token) }).toString()}`);
    }
    throw e; // NEXT_REDIRECT
  }
}
