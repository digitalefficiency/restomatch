import { z } from 'zod';
import { activityEvents, and, desc, eq, lt } from '@restomatch/db';
import { memberProcedure, router } from '../trpc';

export const activityRouter = router({
  /**
   * Recent activity timeline for the current restaurant.
   *
   * NON-BREAKING pagination: still returns the SAME ARRAY (desc by createdAt).
   * When `cursor` (an ISO timestamp) is supplied, only rows strictly older than
   * it are returned — pass the createdAt of the last row of the previous page to
   * load the next page.
   */
  feed: memberProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(50).default(20),
          cursor: z.string().datetime().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const cursorDate = input?.cursor ? new Date(input.cursor) : null;
      return ctx.db
        .select({
          id: activityEvents.id,
          eventType: activityEvents.eventType,
          title: activityEvents.title,
          detail: activityEvents.detail,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.restaurantId, ctx.session.restaurantId),
            cursorDate ? lt(activityEvents.createdAt, cursorDate) : undefined,
          ),
        )
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);
    }),
});
