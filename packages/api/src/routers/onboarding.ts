import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq, memberships, restaurants, sql, users } from '@restomatch/db';
import { z } from 'zod';
import { router, userScopedProcedure } from '../trpc';

export const onboardingRouter = router({
  myMemberships: userScopedProcedure.query(async ({ ctx }) => {
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

  createRestaurant: userScopedProcedure
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
        // Generate the tenant id up front and set the RLS GUC to it, so the
        // insert satisfies restaurants_tenant and RETURNING can see the row.
        // Without a GUC the policies allow no inserts at all.
        const restaurantId = randomUUID();
        await tx.execute(
          sql`select set_config('app.current_restaurant_id', ${restaurantId}, true)`,
        );
        const [restaurant] = await tx
          .insert(restaurants)
          .values({
            id: restaurantId,
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
