import { createHash, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  invitations,
  memberships,
  restaurants,
  users,
} from '@restomatch/db';
import { z } from 'zod';
import { canonicalizeEmail } from '../email';
import type { MemberContext } from '../context';
import { ownerProcedure, router, userScopedProcedure } from '../trpc';

/** Invite link validity. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const roleSchema = z.enum(['owner', 'manager', 'receiver', 'bookkeeper', 'chef']);

/** Cryptographically-random invite token; only its sha256 hash is stored. */
function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
/** The address as typed, lower-cased + trimmed (for storage/display/sending). */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
/** Postgres unique-violation backstop (the pending-invite index is the truth). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  const causeCode = (err as { cause?: { code?: string } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}

/** Number of owners on the caller's restaurant (runs in the member tx). */
async function ownerCount(ctx: MemberContext): Promise<number> {
  const rows = await ctx.db
    .select({ c: count() })
    .from(memberships)
    .where(
      and(eq(memberships.restaurantId, ctx.session.restaurantId), eq(memberships.role, 'owner')),
    );
  return Number(rows[0]?.c ?? 0);
}

export const teamRouter = router({
  /** Members (memberships ⋈ users) + pending invites for the caller's restaurant. */
  list: ownerProcedure.query(async ({ ctx }) => {
    const adminDb = ctx.adminDb ?? ctx.db;
    // Memberships are visible under the tenant RLS policy.
    const memberRows = await ctx.db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .where(eq(memberships.restaurantId, ctx.session.restaurantId))
      .orderBy(desc(memberships.createdAt));

    // Resolve identities on the privileged connection — users_self RLS hides
    // co-members' rows on the tenant connection.
    const userIds = [...new Set(memberRows.map((m) => m.userId))];
    const userRows = userIds.length
      ? await adminDb
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    const byId = new Map(userRows.map((u) => [u.id, u]));
    const members = memberRows.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: byId.get(m.userId)?.email ?? '',
      name: byId.get(m.userId)?.name ?? null,
      createdAt: m.createdAt,
    }));

    const invites = await ctx.db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        invitedByUserId: invitations.invitedByUserId,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.restaurantId, ctx.session.restaurantId),
          eq(invitations.status, 'pending'),
        ),
      )
      .orderBy(desc(invitations.createdAt));

    return { members, invites };
  }),

  /**
   * Create an invite. Returns the one-time raw token so the WEB caller can build
   * the link and send the email AFTER the mutation commits (a network error in
   * here would otherwise roll back a committed invite — member procedures run in
   * a tx). The raw token is never returned to the browser beyond this owner.
   */
  invite: ownerProcedure
    .input(z.object({ email: z.string().email(), role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      const adminDb = ctx.adminDb ?? ctx.db;
      const email = normalizeEmail(input.email);
      const canon = canonicalizeEmail(email);

      // Guard: already a member? Resolve members' emails on the privileged conn.
      const memberEmails = await adminDb
        .select({ email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.restaurantId, ctx.session.restaurantId));
      if (memberEmails.some((u) => canonicalizeEmail(u.email) === canon)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'המשתמש כבר חבר בצוות.' });
      }

      // Guard: an existing pending invite (the partial unique index is the hard
      // backstop; this pre-check gives a friendly message).
      const [pending] = await ctx.db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.restaurantId, ctx.session.restaurantId),
            eq(invitations.email, email),
            eq(invitations.status, 'pending'),
          ),
        )
        .limit(1);
      if (pending) {
        throw new TRPCError({ code: 'CONFLICT', message: 'כבר קיימת הזמנה ממתינה לכתובת הזו.' });
      }

      const rawToken = generateRawToken();
      try {
        await ctx.db.insert(invitations).values({
          restaurantId: ctx.session.restaurantId,
          email,
          role: input.role,
          tokenHash: hashToken(rawToken),
          invitedByUserId: ctx.session.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'כבר קיימת הזמנה ממתינה לכתובת הזו.' });
        }
        throw err;
      }

      const [restaurant] = await ctx.db
        .select({ name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.session.restaurantId))
        .limit(1);
      const [inviter] = await adminDb
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);

      return {
        rawToken,
        email,
        role: input.role,
        restaurantName: restaurant?.name ?? '',
        inviterName: inviter?.name ?? null,
      };
    }),

  /** Rotate the token + bump expiry so old links die; returns the new raw token. */
  resendInvite: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const adminDb = ctx.adminDb ?? ctx.db;
      const [inv] = await ctx.db
        .select()
        .from(invitations)
        .where(
          and(eq(invitations.id, input.id), eq(invitations.restaurantId, ctx.session.restaurantId)),
        )
        .limit(1);
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'ההזמנה לא נמצאה.' });
      if (inv.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'אפשר לשלוח שוב רק הזמנה ממתינה.' });
      }

      const rawToken = generateRawToken();
      await ctx.db
        .update(invitations)
        .set({
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          updatedAt: new Date(),
        })
        .where(eq(invitations.id, inv.id));

      const [restaurant] = await ctx.db
        .select({ name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.session.restaurantId))
        .limit(1);
      const [inviter] = await adminDb
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);

      return {
        rawToken,
        email: inv.email,
        role: inv.role,
        restaurantName: restaurant?.name ?? '',
        inviterName: inviter?.name ?? null,
      };
    }),

  /** Revoke a pending invite (idempotent). */
  revokeInvite: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(invitations)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(
          and(
            eq(invitations.id, input.id),
            eq(invitations.restaurantId, ctx.session.restaurantId),
            eq(invitations.status, 'pending'),
          ),
        );
      return { ok: true };
    }),

  /** Change a member's single role. Blocks demoting the last owner. */
  updateMemberRole: ownerProcedure
    .input(z.object({ userId: z.string().uuid(), role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        );
      if (current.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'החבר לא נמצא.' });
      }
      const wasOwner = current.some((r) => r.role === 'owner');
      if (wasOwner && input.role !== 'owner' && (await ownerCount(ctx)) <= 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חייב להישאר לפחות בעלים אחד.' });
      }

      // Collapse to the single chosen role.
      await ctx.db
        .delete(memberships)
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        );
      await ctx.db.insert(memberships).values({
        userId: input.userId,
        restaurantId: ctx.session.restaurantId,
        role: input.role,
      });
      return { ok: true };
    }),

  /** Remove a member. Blocks removing the last owner. */
  removeMember: ownerProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const roles = await ctx.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        );
      if (roles.length === 0) return { ok: true }; // idempotent
      if (roles.some((r) => r.role === 'owner') && (await ownerCount(ctx)) <= 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חייב להישאר לפחות בעלים אחד.' });
      }
      await ctx.db
        .delete(memberships)
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        );
      return { ok: true };
    }),

  /**
   * Accept an invite after the invitee has logged in (magic link). Runs on the
   * RLS-bypassing auth connection because the accepter is not yet a member of
   * the tenant; correctness rests entirely on the token + email + expiry +
   * status checks here.
   */
  acceptInvite: userScopedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const adminDb = ctx.adminDb ?? ctx.db;
      const [inv] = await adminDb
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, hashToken(input.token)))
        .limit(1);
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'ההזמנה לא נמצאה.' });
      if (inv.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ההזמנה כבר נוצלה או בוטלה.' });
      }
      if (inv.expiresAt.getTime() <= Date.now()) {
        await adminDb
          .update(invitations)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(invitations.id, inv.id));
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'תוקף ההזמנה פג.' });
      }

      const [user] = await adminDb
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'המשתמש לא נמצא.' });
      // Anti-hijack: the invite is bound to the address it was sent to.
      if (canonicalizeEmail(user.email) !== canonicalizeEmail(inv.email)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'ההזמנה נשלחה לכתובת מייל אחרת. התחברו עם הכתובת שאליה נשלחה ההזמנה.',
        });
      }

      // Role from the invitation only — never from client input. Single-use:
      // the status flip + membership insert run together on the admin conn.
      await adminDb.transaction(async (tx) => {
        await tx
          .insert(memberships)
          .values({ userId: ctx.session.userId, restaurantId: inv.restaurantId, role: inv.role })
          .onConflictDoNothing();
        await tx
          .update(invitations)
          .set({
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId: ctx.session.userId,
            updatedAt: new Date(),
          })
          .where(and(eq(invitations.id, inv.id), eq(invitations.status, 'pending')));
      });

      return { restaurantId: inv.restaurantId, role: inv.role };
    }),
});
