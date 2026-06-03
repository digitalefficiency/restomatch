import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { captureException } from '@restomatch/observability';
import type { UserRole } from '@restomatch/db';
import type { AppContext, MemberSession } from './context';

const t = initTRPC.context<AppContext>().create({ transformer: superjson });

/** Report procedure errors to observability (no-op until a client is registered). */
const errorCapture = t.middleware(async ({ next, path, type }) => {
  const result = await next();
  if (!result.ok) {
    captureException(result.error, { trpcPath: path, trpcType: type });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorCapture);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

const memberProcedureBase = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.restaurantId || !ctx.session.role) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User has no active restaurant membership',
    });
  }
  const session: MemberSession = {
    userId: ctx.session.userId,
    restaurantId: ctx.session.restaurantId,
    role: ctx.session.role,
  };
  return next({ ctx: { ...ctx, session } });
});

export const memberProcedure = memberProcedureBase;

function requireRoles(allowed: ReadonlyArray<UserRole>) {
  return memberProcedureBase.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.session.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Required role: ${allowed.join('|')}, got: ${ctx.session.role}`,
      });
    }
    return next();
  });
}

export const ownerProcedure = requireRoles(['owner']);
export const managerProcedure = requireRoles(['owner', 'manager']);
export const receiverProcedure = requireRoles(['owner', 'manager', 'receiver']);
export const bookkeeperProcedure = requireRoles(['owner', 'bookkeeper']);
export const chefProcedure = requireRoles(['owner', 'manager', 'chef']);
