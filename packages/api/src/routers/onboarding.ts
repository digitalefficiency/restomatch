import { eq } from 'drizzle-orm';
import { memberships, restaurants } from '@restomatch/db';
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
      const [restaurant] = await ctx.db
        .insert(restaurants)
        .values({
          name: input.name,
          businessId: input.businessId,
        })
        .returning();
      if (!restaurant) {
        throw new Error('failed to create restaurant');
      }

      await ctx.db.insert(memberships).values({
        userId: ctx.session.userId,
        restaurantId: restaurant.id,
        role: 'owner',
      });

      return restaurant;
    }),
});
