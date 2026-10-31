import { z } from 'zod';
import { ASK_QUESTIONS_PER_DAY, runAsk, usageToday } from '../ask';
import { assertFeature, isFeatureOn } from '../lib/featureGate';
import { managerProcedure, router } from '../trpc';

/**
 * "Ask RestoMatch" (wave 1, flag `aiAssistant`) — owner/manager only, under RLS
 * (member transaction). The model reads the restaurant's data only through the
 * read-only tools in ask/tools.ts, scoped to the SESSION restaurant.
 */
export const askRouter = router({
  status: managerProcedure.query(async ({ ctx }) => {
    const enabled = await isFeatureOn(ctx.db, ctx.session.restaurantId, 'aiAssistant');
    if (!enabled) return { enabled: false, claude: false, questionsLeftToday: 0 };
    const u = await usageToday(ctx.db, ctx.session.restaurantId);
    return {
      enabled: true,
      claude: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ASK_WITH_CLAUDE !== '0',
      questionsLeftToday: Math.max(0, ASK_QUESTIONS_PER_DAY - u.questions),
    };
  }),

  ask: managerProcedure
    .input(
      z.object({
        question: z.string().trim().min(2).max(500),
        locale: z.enum(['he', 'en']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertFeature(ctx.db, ctx.session.restaurantId, 'aiAssistant');
      return runAsk(ctx.db, ctx.session.restaurantId, input.question, input.locale);
    }),
});
