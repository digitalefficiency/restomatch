import { TRPCError } from '@trpc/server';
import { eq, memberships, restaurants, users } from '@restomatch/db';
import { z } from 'zod';
import { authedProcedure, router } from '../trpc';

export const onboardingRouter = router({
  myMemberships: authedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        restaurantId: memberships.restaurantId,
        restaurantName: restaurants.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
      .where(eq(memberships.userId, ctx.session.userId));
    return rows;
  }),

  createRestaurant: authedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        businessId: z
          .string()
          .min(9)
          .max(12)
          .regex(/^\d+$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The session is a stateless JWT stored in the browser cookie. If the
      // DB was reseeded/reset the user row can be gone while the cookie still
      // carries a ghost userId. Verify the user exists first, otherwise the
      // membership insert dies on a raw FK violation and orphans a restaurant.
      const [user] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, ctx.session.userId))
        .limit(1);
      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'החשבון שלך כבר לא קיים. התנתק והתחבר מחדש כדי להמשיך.',
        });
      }

      return ctx.db.transaction(async (tx) => {
        const [restaurant] = await tx
          .insert(restaurants)
          .values({
            name: input.name,
            businessId: input.businessId,
          })
          .returning();
        if (!restaurant) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'failed to create restaurant',
          });
        }

        await tx.insert(memberships).values({
          userId: ctx.session.userId,
          restaurantId: restaurant.id,
          role: 'owner',
        });

        return restaurant;
      });
    }),
});
