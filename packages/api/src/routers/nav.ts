import { z } from 'zod';
import { isFeatureOn } from '../lib/featureGate';
import { memberProcedure, router, userScopedProcedure } from '../trpc';
import { foldBadges } from '../tasks/badges';
import { collectTasks } from '../tasks/collect';
import { WHERE_IS_KINDS, whereIs } from '../tasks/whereIs';
import { priceAlertsRouter } from './priceAlerts';

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
    let priceAlerts = 0;
    if (finance && (await isFeatureOn(ctx.db, ctx.session.restaurantId, 'priceAlerts'))) {
      const sub = { db: ctx.db, adminDb: ctx.adminDb, session: { ...ctx.session } };
      priceAlerts = await priceAlertsRouter
        .createCaller(sub)
        .openCount()
        .then((r) => r.count)
        .catch(() => 0);
    }
    return { badges: foldBadges(tasks, { priceAlerts }), failed };
  }),

  whereIs: userScopedProcedure
    .input(z.object({ kind: z.enum(WHERE_IS_KINDS), id: z.string().uuid() }))
    .query(async ({ ctx, input }) => whereIs(ctx.db, ctx.session.userId, ctx.session.restaurantId, input.kind, input.id)),
});
