import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  accounts,
  and,
  auditLog,
  desc,
  dsrRequests,
  eq,
  leads,
  memberships,
  restaurants,
  sessions,
  users,
  verificationTokens,
  type Database,
} from '@restomatch/db';
import { authedProcedure, adminProcedure, router } from '../trpc';

/**
 * Data-Subject-Rights (DSR) flow — Israeli Privacy Protection Law Amendment 13
 * (E.6). Three self-/admin-gated operations, each one append-only-audited into
 * `dsr_requests`:
 *
 *   • dsr.exportMyData    — authed user exports a portable copy of the personal
 *                           data the platform holds ABOUT THEM (access +
 *                           portability). Self only — scoped by session.userId.
 *   • dsr.deleteMyAccount — authed user erases their own identity. Self only.
 *                           Anonymizes the `users` row and drops mailbox-linked
 *                           auth rows (accounts/sessions/verification_tokens),
 *                           while KEEPING memberships + audit history so tenant
 *                           (restaurant) data integrity is preserved. Refuses if
 *                           the caller is the sole owner of a shared restaurant —
 *                           ownership must be transferred first (no silent
 *                           orphaning of a tenant).
 *   • dsr.eraseLead       — platform-admin erases a marketing lead by id
 *                           (leads are not tenant-scoped; admin handles them).
 *
 * All identity-table reads/writes run on the owner/admin connection
 * (ctx.adminDb): users/accounts/sessions/verification_tokens are REVOKE'd from
 * the per-tenant app role. This router makes NO RLS/auth-config change.
 */

/** Owner/admin connection — identity tables are off-limits to the app role. */
function adminConn(ctx: { adminDb?: Database; db: Database }): Database {
  return ctx.adminDb ?? ctx.db;
}

async function recordDsr(
  db: Database,
  row: {
    subjectType: 'user' | 'lead';
    subjectId: string | null;
    subjectEmail: string | null;
    action: 'export' | 'delete' | 'erase';
    requestedByUserId: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(dsrRequests).values({
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectEmail: row.subjectEmail,
    action: row.action,
    requestedByUserId: row.requestedByUserId,
    details: row.details ?? null,
  });
}

export const dsrRouter = router({
  /**
   * Access + portability: return everything the platform holds about the
   * caller, scoped strictly to their own userId / email.
   */
  exportMyData: authedProcedure.mutation(async ({ ctx }) => {
    const conn = adminConn(ctx);
    const userId = ctx.session.userId;

    const [user] = await conn
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        phone: users.phone,
        image: users.image,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'user not found' });
    }

    const memberRows = await conn
      .select({
        restaurantId: memberships.restaurantId,
        restaurantName: restaurants.name,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(restaurants, eq(restaurants.id, memberships.restaurantId))
      .where(eq(memberships.userId, userId));

    // Marketing leads captured under this email (e.g. before they signed up).
    const leadRows = user.email
      ? await conn
          .select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
            email: leads.email,
            restaurantName: leads.restaurantName,
            source: leads.source,
            marketingConsent: leads.marketingConsent,
            consentAt: leads.consentAt,
            unsubscribedAt: leads.unsubscribedAt,
            createdAt: leads.createdAt,
          })
          .from(leads)
          .where(eq(leads.email, user.email))
      : [];

    // The caller's own action history (metadata only — no other tenants' rows).
    const activityRows = await conn
      .select({
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        restaurantId: auditLog.restaurantId,
        at: auditLog.at,
      })
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(desc(auditLog.at))
      .limit(1000);

    const priorRequests = await conn
      .select({
        action: dsrRequests.action,
        status: dsrRequests.status,
        createdAt: dsrRequests.createdAt,
      })
      .from(dsrRequests)
      .where(and(eq(dsrRequests.subjectType, 'user'), eq(dsrRequests.subjectId, userId)))
      .orderBy(desc(dsrRequests.createdAt));

    await recordDsr(conn, {
      subjectType: 'user',
      subjectId: userId,
      subjectEmail: user.email,
      action: 'export',
      requestedByUserId: userId,
      details: {
        counts: {
          memberships: memberRows.length,
          leads: leadRows.length,
          activity: activityRows.length,
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      subject: 'user' as const,
      user,
      memberships: memberRows,
      leads: leadRows,
      activity: activityRows,
      priorDsrRequests: priorRequests,
    };
  }),

  /**
   * Erasure of the caller's own account. Self only — there is intentionally NO
   * target-user parameter, so a member can never erase another person.
   */
  deleteMyAccount: authedProcedure
    .input(z.object({ confirm: z.literal(true) }))
    .mutation(async ({ ctx }) => {
      const conn = adminConn(ctx);
      const userId = ctx.session.userId;

      const [user] = await conn
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'user not found' });
      }

      // Tenant-integrity guard: block erasure while the caller is the sole owner
      // of a restaurant that still has OTHER members. Ownership must be handed
      // over first so the tenant is not orphaned.
      const ownerMemberships = await conn
        .select({ restaurantId: memberships.restaurantId })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));

      for (const m of ownerMemberships) {
        const others = await conn
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.restaurantId, m.restaurantId));
        const otherUserIds = new Set(others.map((o) => o.userId));
        otherUserIds.delete(userId);
        const otherOwners = await conn
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(eq(memberships.restaurantId, m.restaurantId), eq(memberships.role, 'owner')),
          );
        const hasAnotherOwner = otherOwners.some((o) => o.userId !== userId);
        if (otherUserIds.size > 0 && !hasAnotherOwner) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'SOLE_OWNER_TRANSFER_REQUIRED: יש להעביר בעלות על המסעדה למשתמש אחר לפני מחיקת החשבון',
          });
        }
      }

      // Anonymize the identity row (keep the row so memberships/audit stay
      // referentially intact) and drop mailbox-linked auth rows. We import the
      // auth tables lazily via raw SQL to avoid widening the schema import here.
      const tombstoneEmail = `deleted+${userId}@deleted.restomatch.invalid`;
      await conn
        .update(users)
        .set({
          email: tombstoneEmail,
          name: null,
          phone: null,
          image: null,
          emailVerified: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Remove mailbox / session identity so the account can no longer be
      // authenticated. Tables are REVOKE'd from the app role → owner conn only.
      await conn.delete(sessions).where(eq(sessions.userId, userId));
      await conn.delete(accounts).where(eq(accounts.userId, userId));
      if (user.email) {
        await conn.delete(verificationTokens).where(eq(verificationTokens.identifier, user.email));
      }

      await recordDsr(conn, {
        subjectType: 'user',
        subjectId: userId,
        subjectEmail: user.email,
        action: 'delete',
        requestedByUserId: userId,
        details: { anonymized: true, tombstoneEmail },
      });

      return { ok: true as const, anonymized: true };
    }),

  /**
   * Platform-admin erasure of a marketing lead (leads are not tenant-scoped).
   */
  eraseLead: adminProcedure
    .input(z.object({ leadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conn = adminConn(ctx);
      const [lead] = await conn
        .select({ id: leads.id, email: leads.email })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);
      if (!lead) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'lead not found' });
      }

      await conn.delete(leads).where(eq(leads.id, input.leadId));

      await recordDsr(conn, {
        subjectType: 'lead',
        subjectId: input.leadId,
        subjectEmail: lead.email,
        action: 'erase',
        requestedByUserId: ctx.session.userId,
      });

      return { ok: true as const };
    }),
});
