import { z } from 'zod';
import { eq, restaurants, users, type Database } from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled } from '../lib/features';
import {
  claimLeakCheck,
  leakCheckSecret,
  listClaimedLeakChecks,
  verifyResultLink,
} from '../leakCheck';
import { managerProcedure, ownerProcedure, router } from '../trpc';

/**
 * Tenant side of the free leak check ("start a trial with your data carried
 * over"). The prospect's sandbox session (leak_check_sessions, RLS-closed to the
 * tenant role) is reached ONLY through a valid signed link the prospect holds;
 * the restaurant comes from the session, never from the client. The sandbox is
 * read on the owner connection (ctx.adminDb) and every read is filtered on the
 * caller's own restaurant id.
 */
async function assertLeakCheckEnabled(db: Database, restaurantId: string): Promise<void> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!featureEnabled(r?.settings, 'leakCheck')) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'התכונה אינה זמינה למסעדה זו');
  }
}

export const leakCheckRouter = router({
  /** Attach a leak-check result to the caller's restaurant (owner only). */
  claim: ownerProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertLeakCheckEnabled(ctx.db, ctx.session.restaurantId);
      const sessionId = verifyResultLink(leakCheckSecret(), input.token);
      if (!sessionId) {
        throw appError('BAD_REQUEST', 'leakCheck.invalidLink', 'הקישור לבדיקת הדליפה פג תוקף או אינו תקין');
      }
      const [me] = await ctx.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);
      const ok = me?.email
        ? await claimLeakCheck(ctx.adminDb ?? ctx.db, sessionId, ctx.session.restaurantId, me.email)
        : false;
      if (!ok) {
        throw appError('BAD_REQUEST', 'leakCheck.invalidLink', 'הקישור לבדיקת הדליפה פג תוקף או אינו תקין');
      }
      return { ok: true as const };
    }),

  /** The caller's restaurant's carried-over leak checks (summary + findings). */
  claimed: managerProcedure.query(async ({ ctx }) => {
    await assertLeakCheckEnabled(ctx.db, ctx.session.restaurantId);
    const rows = await listClaimedLeakChecks(ctx.adminDb ?? ctx.db, ctx.session.restaurantId);
    return rows.map((r) => ({
      id: r.id,
      ocrMode: r.ocrMode,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      leakAgorot: r.report.leakAgorot,
      spendAgorot: r.report.spendAgorot,
      invoiceCount: r.invoices.length,
      findings: r.report.findings,
    }));
  }),
});
