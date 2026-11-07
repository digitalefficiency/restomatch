import 'server-only';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  and,
  count,
  eq,
  gt,
  invitations,
  inArray,
  isNotNull,
  or,
  sql,
  restaurants,
  userCredentials,
  users,
  verificationTokens,
  type UserRole,
} from '@restomatch/db';
import { canonicalizeEmail } from '@restomatch/api';
import { authDb } from '@/lib/authDb';
import { passwordPolicyError } from '@/lib/passwordPolicy';
import { normalizeLoginEmail, setUserPassword } from '@/lib/passwords';

/**
 * W3-07b — the public join path: `/join/<token>` → 6-digit e-mail code → own
 * name + password → signed in. A NEW PUBLIC AUTH WRITE PATH (programme risk 14):
 * every rule below is server-side, on the owner auth connection (identity zone,
 * like the password-reset flow), and covered by join.attack.test.ts.
 *
 * Trust model:
 *  - The invite token (32 random bytes, only its sha256 is stored, 7-day,
 *    single-use) proves you were handed the invite link.
 *  - The e-mail code proves you control the INVITED mailbox. The address is
 *    always the invitation's — never anything the client typed.
 *  - The role and restaurant come only from the invitation row; the membership
 *    itself is created by the existing, audited `team.acceptInvite` after the
 *    Credentials sign-in (so its email-bound / single-use checks still apply).
 *
 * The code store needs no schema change: `verification_tokens` (Auth.js
 * identity table) holds `join:<invitationId>` → HMAC(code). Failed attempts are
 * durable marker rows, reserved BEFORE the compare, so the attempt ceilings hold
 * even when the rate-limit store fails open and under concurrent guesses.
 */

export const JOIN_CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong codes allowed per rolling 10-minute window (per invite). */
export const JOIN_CODE_MAX_ATTEMPTS = 5;
/** Wrong codes allowed over the token's whole life; then the inviter must resend (rotates the token). */
export const JOIN_CODE_MAX_TOTAL_ATTEMPTS = 20;

export type InviteState = 'valid' | 'expired' | 'used' | 'notFound';

export interface InviteView {
  id: string;
  state: InviteState;
  /** Only filled for a valid invite — a dead token never reveals the tenant. */
  restaurantName: string | null;
  role: UserRole | null;
  inviterName: string | null;
  /** The invited address, masked for display (valid invites only). */
  maskedEmail: string | null;
  /** Locale chosen by the inviter ('he' | 'en' | null). */
  locale: 'he' | 'en' | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  expiresAt: Date;
  tokenHash: string;
  preferredLocale: string | null;
}

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A token is base64url (43 chars for 32 bytes); anything else is not worth a DB read. */
export function plausibleToken(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(raw);
}

export function stateOf(row: Pick<InviteRow, 'status' | 'expiresAt'> | null, now = Date.now()): InviteState {
  if (!row) return 'notFound';
  if (row.status !== 'pending') return row.status === 'expired' ? 'expired' : 'used';
  if (row.expiresAt.getTime() <= now) return 'expired';
  return 'valid';
}

/** `dana@example.com` → `d•••a@example.com`; keeps the domain so the invitee recognises it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}•••${domain}`;
  return `${local[0]}•••${local[local.length - 1]}${domain}`;
}

async function inviteRowByToken(token: string): Promise<InviteRow | null> {
  if (!plausibleToken(token)) return null;
  const [row] = await authDb
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      tokenHash: invitations.tokenHash,
      preferredLocale: invitations.preferredLocale,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, hashInviteToken(token)))
    .limit(1);
  return row ?? null;
}

/** What `/join/<token>` may show. */
export async function loadInvite(token: string, now = Date.now()): Promise<InviteView> {
  const row = await inviteRowByToken(token);
  const state = stateOf(row, now);
  if (!row || state !== 'valid') {
    return { id: row?.id ?? '', state, restaurantName: null, role: null, inviterName: null, maskedEmail: null, locale: null };
  }
  const [ctx] = await authDb
    .select({ restaurantName: restaurants.name, inviterName: users.name })
    .from(invitations)
    .innerJoin(restaurants, eq(restaurants.id, invitations.restaurantId))
    .leftJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(eq(invitations.id, row.id))
    .limit(1);
  return {
    id: row.id,
    state,
    restaurantName: ctx?.restaurantName ?? null,
    role: row.role,
    inviterName: ctx?.inviterName?.trim() || null,
    maskedEmail: maskEmail(row.email),
    locale: row.preferredLocale === 'en' ? 'en' : row.preferredLocale === 'he' ? 'he' : null,
  };
}

/**
 * Canonical form of `users.email` in SQL — the same rules as @restomatch/api
 * canonicalizeEmail (strip +tag; Gmail ignores dots, googlemail = gmail), so an
 * alias of an address that already has a password is treated as that account.
 */
function canonicalEmailSql() {
  return sql<string>`(case when split_part(lower(${users.email}), '@', 2) in ('gmail.com', 'googlemail.com')
    then replace(regexp_replace(split_part(lower(${users.email}), '@', 1), '[+].*$', ''), '.', '') || '@gmail.com'
    else regexp_replace(split_part(lower(${users.email}), '@', 1), '[+].*$', '') || '@' || split_part(lower(${users.email}), '@', 2) end)`;
}

/** Any account for this address (or a canonical alias of it) that already has a password. */
async function passwordAccountExists(email: string): Promise<boolean> {
  const [u] = await authDb
    .select({ id: users.id })
    .from(users)
    .innerJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(
      or(
        eq(users.email, normalizeLoginEmail(email)),
        and(isNotNull(userCredentials.passwordHash), eq(canonicalEmailSql(), canonicalizeEmail(email))),
      ),
    )
    .limit(1);
  return Boolean(u);
}

/** Does the invited address already have a password? Then it signs in instead of joining by code. */
export async function invitedAccountHasPassword(token: string): Promise<boolean> {
  const row = await inviteRowByToken(token);
  return row ? passwordAccountExists(row.email) : false;
}

/* ── the e-mail code ─────────────────────────────────────────────────────── */

function hmacKey(): string {
  const key = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('AUTH_SECRET is required for join codes');
  return key;
}

/** Bound to the invitation AND its current token hash: a resend (token rotation) kills old codes. */
export function codeDigest(inv: Pick<InviteRow, 'id' | 'tokenHash'>, code: string): string {
  return createHmac('sha256', hmacKey()).update(`join:${inv.id}:${inv.tokenHash}:${code}`).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const codeId = (invId: string) => `join:${invId}`;
const windowFailId = (invId: string) => `join-fail:${invId}`;
const totalFailId = (inv: Pick<InviteRow, 'id' | 'tokenHash'>) => `join-failtotal:${inv.id}:${inv.tokenHash.slice(0, 16)}`;

export type IssueResult =
  | { ok: true; code: string; email: string; locale: 'he' | 'en' | null }
  | { ok: false; reason: Exclude<InviteState, 'valid'> | 'hasPassword' };

/**
 * Mint a fresh code for a valid invite (any earlier code dies). The CALLER sends
 * it to `email` — the invitation's own address — and rate-limits the send.
 */
export async function issueJoinCode(token: string, now = Date.now()): Promise<IssueResult> {
  const row = await inviteRowByToken(token);
  const state = stateOf(row, now);
  if (!row || state !== 'valid') return { ok: false, reason: state === 'valid' ? 'notFound' : state };
  if (await invitedAccountHasPassword(token)) return { ok: false, reason: 'hasPassword' };
  const code = generateCode();
  await authDb.transaction(async (tx) => {
    await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(row.id)));
    await tx.insert(verificationTokens).values({
      identifier: codeId(row.id),
      token: codeDigest(row, code),
      expires: new Date(now + JOIN_CODE_TTL_MS),
    });
  });
  return {
    ok: true,
    code,
    email: row.email,
    locale: row.preferredLocale === 'en' ? 'en' : row.preferredLocale === 'he' ? 'he' : null,
  };
}

async function countLive(identifier: string, now: number): Promise<number> {
  const [r] = await authDb
    .select({ c: count() })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), gt(verificationTokens.expires, new Date(now))));
  return Number(r?.c ?? 0);
}

export type CompleteResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason: Exclude<InviteState, 'valid'> | 'hasPassword' | 'noCode' | 'wrongCode' | 'locked' | 'policy' | 'name';
      message?: string;
    };

export const MAX_NAME_LENGTH = 80;

/** A display name: trimmed, 2–80 chars, no control characters. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/**
 * Verify the code and create the invitee's identity (user + password). The
 * membership is NOT written here: the caller signs the user in and sends them
 * through `team.acceptInvite`, which re-checks token / address / expiry /
 * status and writes membership + audit in one transaction.
 */
export async function completeJoin(
  input: { token: string; code: string; name: unknown; password: string },
  now = Date.now(),
): Promise<CompleteResult> {
  const row = await inviteRowByToken(input.token);
  const state = stateOf(row, now);
  if (!row || state !== 'valid') return { ok: false, reason: state === 'valid' ? 'notFound' : state };

  const name = cleanName(input.name);
  if (!name) return { ok: false, reason: 'name' };
  const policy = passwordPolicyError(input.password);
  if (policy) return { ok: false, reason: 'policy', message: policy };

  const code = String(input.code ?? '').replace(/\D/g, '');
  const [stored] = await authDb
    .select({ token: verificationTokens.token, expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, codeId(row.id)), gt(verificationTokens.expires, new Date(now))))
    .limit(1);
  if (!stored) return { ok: false, reason: 'noCode' };

  // Reserve the attempt first, then count (concurrent guesses can't overshoot).
  await authDb.insert(verificationTokens).values([
    { identifier: windowFailId(row.id), token: randomUUID(), expires: new Date(now + JOIN_CODE_TTL_MS) },
    { identifier: totalFailId(row), token: randomUUID(), expires: row.expiresAt },
  ]);
  const [inWindow, total] = await Promise.all([countLive(windowFailId(row.id), now), countLive(totalFailId(row), now)]);
  if (inWindow > JOIN_CODE_MAX_ATTEMPTS || total > JOIN_CODE_MAX_TOTAL_ATTEMPTS) {
    // Too many guesses: the current code dies too, so a lucky late guess can't land.
    await authDb.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(row.id)));
    return { ok: false, reason: 'locked' };
  }

  const expected = Buffer.from(stored.token, 'hex');
  const given = Buffer.from(code.length === 6 ? codeDigest(row, code) : '00', 'hex');
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  if (!match) return { ok: false, reason: 'wrongCode' };

  const email = normalizeLoginEmail(row.email);
  const [existing] = await authDb
    .select({ id: users.id, name: users.name, hasPassword: userCredentials.passwordHash })
    .from(users)
    .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);
  // An account that already has a password (or a canonical alias that has one)
  // is never overwritten or duplicated by a code.
  if (existing?.hasPassword || (await passwordAccountExists(row.email))) return { ok: false, reason: 'hasPassword' };

  let userId = existing?.id;
  if (userId) {
    await authDb
      .update(users)
      .set({ emailVerified: new Date(now), ...(existing?.name?.trim() ? {} : { name }), updatedAt: new Date(now) })
      .where(eq(users.id, userId));
  } else {
    const [created] = await authDb
      .insert(users)
      .values({ email, name, emailVerified: new Date(now) })
      .onConflictDoNothing()
      .returning({ id: users.id });
    userId = created?.id;
    if (!userId) {
      // Lost a race with a parallel completion — that one wins; this one re-checks.
      return { ok: false, reason: 'hasPassword' };
    }
  }
  await setUserPassword(userId, input.password);

  // The code is spent; window markers go too (the lifetime ones stay, harmless).
  await authDb
    .delete(verificationTokens)
    .where(inArray(verificationTokens.identifier, [codeId(row.id), windowFailId(row.id)]));
  return { ok: true, email };
}
