import { z } from 'zod';
import { memberProcedure, router } from '../trpc';
import { collectTasks } from '../tasks/collect';

/**
 * The task spine (W2-08): "מחכה לך". One computed, per-viewer list feeding the
 * home rows, the nav badges and the bell, so a queue shows the same ₪ on every
 * screen. No table (seen-state and a tasks table are H-04).
 *
 * Scope = the session's own role (the home asks for the role it renders; any
 * other value is refused, so nobody reads another role's queue). ₪ is `null`
 * on the server for roles without money.view (receiver, chef).
 */
export const tasksRouter = router({
  mine: memberProcedure
    .input(z.object({ role: z.enum(['owner', 'manager', 'bookkeeper', 'receiver', 'chef']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // `role` is a cache key for the client, never a widening: it must equal the session's.
      if (input?.role && input.role !== ctx.session.role) return { tasks: [], restaurantClear: false, failed: ['role'] };
      return collectTasks(ctx);
    }),
});
