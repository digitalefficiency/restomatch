import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { AppContext } from './context.js';

const t = initTRPC.context<AppContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

export const ownerProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.session.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner role required' });
  }
  return next();
});
