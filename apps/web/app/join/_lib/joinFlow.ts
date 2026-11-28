import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  and,
  count,
  eq,
  gt,
  invitations,
  inArray,
  or,
  sql,
  restaurants,
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
/** Wrong codes allowed per rolling 10-minute window, per invited ADDRESS. */
export const JOIN_CODE_MAX_ATTEMPTS = 5;
/**
 * Wrong codes allowed per invited ADDRESS per rolling 7 days (an invite's life).
 * Keyed on the address, not the invitation or its token, so a resend, a
 * revoke + re-invite, or a second restaurant inviting the same mailbox never
 * resets it (security review B5).
 */
export const JOIN_CODE_MAX_TOTAL_ATTEMPTS = 20;
export const JOIN_CODE_TOTAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Codes sent per invited address: 3 per 15 minutes, 10 per 24 hours (durable, B5). */
export const JOIN_CODE_SENDS_PER_15_MIN = 3;
export const JOIN_CODE_SENDS_PER_DAY = 10;

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
 * Server-side only: the invited address (unmasked), restaurant and locale of a
 * valid invite — what the sign-in-link e-mail needs. Never sent to the client.
 */
export async function joinContact(
  token: string,
  now = Date.now(),
): Promise<{ email: string; restaurantName: string | null; locale: 'he' | 'en' } | null> {
  const row = await inviteRowByToken(token);
  if (!row || stateOf(row, now) !== 'valid') return null;
  const view = await loadInvite(token, now);
  return { email: row.email, restaurantName: view.restaurantName, locale: view.locale ?? 'he' };
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

/**
 * Is there ANY account for this address or a canonical alias of it — with or
 * without a password (magic-link-only users included)? Then the invitee signs
 * in instead: a join code only ever creates a NEW account and never sets a
 * password on an existing row (security review B5: a code is not proof enough
 * to take over an account that already exists).
 */
async function accountExists(email: string): Promise<boolean> {
  const [u] = await authDb
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, normalizeLoginEmail(email)), eq(canonicalEmailSql(), canonicalizeEmail(email))))
    .limit(1);
  return Boolean(u);
}

/** Does the invited address already have an account? Then it signs in instead of joining by code. */
export async function invitedAccountExists(token: string): Promise<boolean> {
  const row = await inviteRowByToken(token);
  return row ? accountExists(row.email) : false;
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

/**
 * The durable-ceiling key for an invited address: HMAC-SHA256 of the canonical
 * address (never the invitation id or token hash, never the raw address), so
 * every invite to the same mailbox — and every alias of it — shares one budget.
 */
export function joinAddressKey(email: string): string {
  return createHmac('sha256', hmacKey()).update(`join-addr:${canonicalizeEmail(email)}`).digest('hex').slice(0, 40);
}

const codeId = (invId: string) => `join:${invId}`;
const windowFailId = (addr: string) => `join-fail:${addr}`;
const totalFailId = (addr: string) => `join-failtotal:${addr}`;
const sendId = (addr: string) => `join-send:${addr}`;
const sendDayId = (addr: string) => `join-send-d:${addr}`;
/** Per-INVITATION attempt counters: every attempt, with or without a live code. */
const invWindowFailId = (invId: string) => `join-fail-inv:${invId}`;
const invTotalFailId = (invId: string) => `join-failtotal-inv:${invId}`;

export type IssueResult =
  | { ok: true; code: string; email: string; locale: 'he' | 'en' | null }
  | { ok: false; reason: Exclude<InviteState, 'valid'> | 'rate' }
  /**
   * An existing account: no code is sent (the caller e-mails a sign-in link). A
   * decoy row is written when not throttled. `throttled` = the per-address send
   * cap is hit (same cap as a new address); the caller answers like a sent e-mail.
   */
  | { ok: false; reason: 'hasPassword'; throttled: boolean };

/**
 * Mint a fresh code for a valid invite (any earlier code dies). The CALLER sends
 * it to `email` — the invitation's own address — and rate-limits the send.
 */
export async function issueJoinCode(token: string, now = Date.now()): Promise<IssueResult> {
  const row = await inviteRowByToken(token);
  const state = stateOf(row, now);
  if (!row || state !== 'valid') return { ok: false, reason: state === 'valid' ? 'notFound' : state };
  // Per-address send cap FIRST, for existing and new addresses alike, so the cap
  // is no account oracle. Durable (holds when the limiter fails open). Count
  // first: at the cap, return throttled WITHOUT inserting, so a token holder
  // cannot keep the cap up for free (review r2 finding 2).
  const addr = joinAddressKey(row.email);
  const sendCaps = [JOIN_CODE_SENDS_PER_15_MIN, JOIN_CODE_SENDS_PER_DAY];
  const sendIds = [sendId(addr), sendDayId(addr)];
  // ONE transaction under the address's send lock: count; insert the send
  // markers only when below BOTH caps; and write the code row in the same
  // transaction, so overlapping sends can't leave two code rows behind (review
  // r3). Parallel sends queue on the lock, so exactly as many pass as the cap
  // allows, and a throttled send writes nothing. A lock timeout counts as
  // throttled (answered like a sent e-mail; nothing is sent).
  const existing = await accountExists(row.email);
  const code = generateCode();
  let throttled: boolean;
  try {
    throttled = await authDb.transaction(async (tx) => {
      await lockAddress(tx, 'send', addr);
      const counts = await Promise.all(sendIds.map((id) => countLive(id, now, tx)));
      // A throttled send leaves the code rows untouched, for both kinds of address.
      if (counts.some((c, i) => c >= sendCaps[i]!)) return true;
      await tx.insert(verificationTokens).values([
        { identifier: sendId(addr), token: randomUUID(), expires: new Date(now + 15 * 60 * 1000) },
        { identifier: sendDayId(addr), token: randomUUID(), expires: new Date(now + 24 * 60 * 60 * 1000) },
      ]);
      // Unthrottled: a code row is written either way, with the same TTL. A new
      // address gets the real code. An existing account (the caller e-mails it a
      // sign-in link) gets a DECOY: a random digest no 6-digit code can match.
      // So completeJoin reads and charges the same counters in both cases: no
      // cross-invite account oracle (review r2 finding 1). Even if a decoy
      // matched, completeJoin refuses an existing account (B5).
      //
      // A decoy never replaces a live row: a real code minted before the account
      // appeared keeps its token (completeJoin refuses it with 'hasPassword';
      // main's B5 asserts this across a resend). Its expiry moves to now + TTL,
      // exactly as a resend's fresh code would.
      if (existing) {
        const refreshed = await tx
          .update(verificationTokens)
          .set({ expires: new Date(now + JOIN_CODE_TTL_MS) })
          .where(and(eq(verificationTokens.identifier, codeId(row.id)), gt(verificationTokens.expires, new Date(now))))
          .returning({ identifier: verificationTokens.identifier });
        if (refreshed.length > 0) return false;
      }
      await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(row.id)));
      await tx.insert(verificationTokens).values({
        identifier: codeId(row.id),
        token: existing ? randomBytes(32).toString('hex') : codeDigest(row, code),
        expires: new Date(now + JOIN_CODE_TTL_MS),
      });
      return false;
    });
  } catch (err) {
    if (!isLockTimeout(err)) throw err;
    throttled = true;
  }
  // The caller answers a throttled send like a sent e-mail and sends nothing.
  if (throttled) return existing ? { ok: false, reason: 'hasPassword', throttled: true } : { ok: false, reason: 'rate' };
  if (existing) return { ok: false, reason: 'hasPassword', throttled: false };
  return {
    ok: true,
    code,
    email: row.email,
    locale: row.preferredLocale === 'en' ? 'en' : row.preferredLocale === 'he' ? 'he' : null,
  };
}

type Tx = Parameters<Parameters<typeof authDb.transaction>[0]>[0];
type Conn = typeof authDb | Tx;

/** How long a locked transaction waits for the address lock before giving up. */
export const JOIN_LOCK_TIMEOUT = '3s';

/** Postgres lock_not_available (55P03): the lock wait hit lock_timeout. */
function isLockTimeout(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '55P03' || e?.cause?.code === '55P03';
}

/**
 * Serialise every count-then-insert on one address (review r3): a transaction-
 * scoped advisory lock, so parallel sends or guesses cannot all pass the
 * pre-count. Released at commit/rollback.
 */
async function lockAddress(tx: Tx, scope: 'send' | 'attempt', addr: string): Promise<void> {
  // A transaction only: on the pool an xact lock would be a silent no-op. Bounded
  // wait: a frozen holder can't block the address or pin the auth pool; the
  // caller maps a timeout to its ceiling answer.
  await tx.execute(sql.raw(`set local lock_timeout = '${JOIN_LOCK_TIMEOUT}'`));
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`join-${scope}:${addr}`}, 0))`);
}

async function countLive(identifier: string, now: number, db: Conn = authDb): Promise<number> {
  const [r] = await db
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

  // Attempt ceilings (security review of the /join oracle branch, finding 1):
  //  - PER INVITATION, every attempt (live code or not): ≤ 5 per 10 min and
  //    ≤ 20 over the invite's life. These are the only counters an attempt
  //    with NO live code touches, so a token holder posting guesses without
  //    a code (an existing account never gets one) can neither read nor spend
  //    the address's budget in other restaurants.
  //  - PER ADDRESS (B5), only while a code is LIVE: ≤ 5 per 10 min, ≤ 20 per
  //    7 days, shared by every invite to the mailbox, so resend / revoke +
  //    re-invite cannot reset real guessing. Each such burst costs the mailbox
  //    an e-mail (a code had to be sent), as in the base.
  // Already at a ceiling → answer 'locked' WITHOUT inserting more markers.
  const code = String(input.code ?? '').replace(/\D/g, '');
  const [stored] = await authDb
    .select({ token: verificationTokens.token, expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, codeId(row.id)), gt(verificationTokens.expires, new Date(now))))
    .limit(1);
  const addr = joinAddressKey(row.email);
  const ids = stored
    ? [invWindowFailId(row.id), invTotalFailId(row.id), windowFailId(addr), totalFailId(addr)]
    : [invWindowFailId(row.id), invTotalFailId(row.id)];
  const caps = [JOIN_CODE_MAX_ATTEMPTS, JOIN_CODE_MAX_TOTAL_ATTEMPTS, JOIN_CODE_MAX_ATTEMPTS, JOIN_CODE_MAX_TOTAL_ATTEMPTS];
  const killAndLock = async (): Promise<CompleteResult> => {
    // Too many guesses: the current code dies too, so a lucky late guess can't land.
    await authDb.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(row.id)));
    return { ok: false, reason: 'locked' };
  };
  // One transaction under the address's attempt lock: count, and reserve only
  // when below every ceiling. Parallel guesses queue on the lock, so a burst on
  // one live code adds at most the window cap to the address total (review r3).
  const expiresOf = (id: string) =>
    id === invWindowFailId(row.id) || id === windowFailId(addr)
      ? new Date(now + JOIN_CODE_TTL_MS)
      : id === invTotalFailId(row.id)
        ? row.expiresAt
        : new Date(now + JOIN_CODE_TOTAL_WINDOW_MS);
  let atCeiling: boolean;
  try {
    atCeiling = await authDb.transaction(async (tx) => {
      await lockAddress(tx, 'attempt', addr);
      const counts = await Promise.all(ids.map((id) => countLive(id, now, tx)));
      if (counts.some((c, i) => c >= caps[i]!)) return true;
      await tx.insert(verificationTokens).values(ids.map((id) => ({ identifier: id, token: randomUUID(), expires: expiresOf(id) })));
      return false;
    });
  } catch (err) {
    if (!isLockTimeout(err)) throw err;
    // Lock contention: refuse this attempt as 'locked' (nothing reserved, the
    // live code is left alone, so a contention burst cannot kill it).
    return { ok: false, reason: 'locked' };
  }
  if (atCeiling) return killAndLock();

  if (!stored) return { ok: false, reason: 'noCode' };

  const expected = Buffer.from(stored.token, 'hex');
  const given = Buffer.from(code.length === 6 ? codeDigest(row, code) : '00', 'hex');
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  if (!match) return { ok: false, reason: 'wrongCode' };

  // B5: ANY existing account for the address (or a canonical alias) — with or
  // without a password — signs in instead. A code never touches an existing
  // row: no password set, no name or emailVerified written.
  const email = normalizeLoginEmail(row.email);
  if (await accountExists(row.email)) return { ok: false, reason: 'hasPassword' };

  // Only a brand-new row is ever given a password. A parallel insert of the
  // same address loses here and is sent to sign in.
  const [created] = await authDb
    .insert(users)
    .values({ email, name, emailVerified: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!created?.id) return { ok: false, reason: 'hasPassword' };
  await setUserPassword(created.id, input.password);

  // The code is spent; the window markers and this invite's counters go too.
  // The 7-day address markers stay (an address that has joined no longer gets
  // codes at all, so they are never read for it again).
  await authDb
    .delete(verificationTokens)
    .where(
      inArray(verificationTokens.identifier, [codeId(row.id), windowFailId(addr), invWindowFailId(row.id), invTotalFailId(row.id)]),
    );
  return { ok: true, email };
}

/**
 * What the PUBLIC /join page may learn from a completion attempt. "No live code"
 * and "this address already has an account" both read as a wrong code, so a
 * tenant owner who invites an address cannot tell whether it has a RestoMatch
 * account (security review, /join existence oracle).
 */
export function publicCompleteReason(
  reason: Extract<CompleteResult, { ok: false }>['reason'],
): Exclude<Extract<CompleteResult, { ok: false }>['reason'], 'noCode' | 'hasPassword'> {
  return reason === 'noCode' || reason === 'hasPassword' ? 'wrongCode' : reason;
}
