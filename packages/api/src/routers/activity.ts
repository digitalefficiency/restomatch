import { z } from 'zod';
import { activityEvents, desc, eq } from '@restomatch/db';
import { memberProcedure, router } from '../trpc';

export const activityRouter = router({
  /** Recent activity timeline for the current restaurant. */
  feed: memberProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      return ctx.db
        .select({
          id: activityEvents.id,
          eventType: activityEvents.eventType,
          title: activityEvents.title,
          detail: activityEvents.detail,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(eq(activityEvents.restaurantId, ctx.session.restaurantId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);
    }),
});
