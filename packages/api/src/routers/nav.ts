import { z } from 'zod';
import { isFeatureOn } from '../lib/featureGate';
import { memberProcedure, router, userScopedProcedure } from '../trpc';
import { foldBadges, linkBadge } from '../tasks/badges';
import { buildLinkQueue, summarizeLinkQueue } from '../catalog/linkQueue';
import { loadLinkQueueCandidates } from '../catalog/linkQueueLoad';
import { collectTasks } from '../tasks/collect';
import { WHERE_IS_KINDS, whereIs } from '../tasks/whereIs';
import { priceAlertsRouter } from './priceAlerts';
import { recoveryRouter } from './recovery';

/**
 * Navigation helpers (W2-08).
 * - `badges`: ONE request for every nav badge, folded from the same task spine
 *   the home reads (so a badge's ₪ is the home row's ₪). Receiver/chef get
 *   counts only (the spine nulls ₪ on the server).
 * - `whereIs`: a record that 404'd here — is it in another branch I belong to?
 */
export const navRouter = router({
  badges: memberProcedure.query(async ({ ctx }) => {
    const { tasks, failed } = await collectTasks(ctx);
    const finance = ['owner', 'manager', 'bookkeeper'].includes(ctx.session.role);
    const rid = ctx.session.restaurantId;
    const sub = { db: ctx.db, adminDb: ctx.adminDb, session: { ...ctx.session } };
    let priceAlerts = 0;
    if (finance && (await isFeatureOn(ctx.db, rid, 'priceAlerts'))) {
      // A failed read is reported (never a silent 0 — G-16).
      try {
        priceAlerts = (await priceAlertsRouter.createCaller(sub).openCount()).count;
      } catch {
        failed.push('priceAlerts');
      }
    }
    const badges = foldBadges(tasks, { priceAlerts });
    // The claims badge shows the ₪ of the page it opens (recovery hero "זיכויים פתוחים"),
    // not the sum of its tasks — one figure per destination (train C review).
    if (finance && badges.claims && (await isFeatureOn(ctx.db, rid, 'recovery'))) {
      try {
        const owed = (await recoveryRouter.createCaller(sub).summary()).summary.outstandingAgorot;
        badges.claims = { ...badges.claims, ilsAgorot: owed > 0 ? owed : null, money: 'owed' };
      } catch {
        failed.push('claimsOwed');
      }
    }
    // W3-10 · "N לקישור · ₪X עוד לא נבדקו": the one לקשר queue's summary, neutral
    // always. It carries ₪, so only owner / manager / bookkeeper get it.
    if (finance) {
      try {
        const link = linkBadge(summarizeLinkQueue(buildLinkQueue(await loadLinkQueueCandidates(ctx.db, rid))), finance);
        if (link) badges.link = link;
      } catch {
        failed.push('link');
      }
    }
    return { badges, failed };
  }),

  whereIs: userScopedProcedure
    .input(z.object({ kind: z.enum(WHERE_IS_KINDS), id: z.string().uuid() }))
    .query(async ({ ctx, input }) => whereIs(ctx.db, ctx.session.userId, ctx.session.restaurantId, input.kind, input.id)),
});
