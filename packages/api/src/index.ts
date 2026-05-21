import { router } from './trpc.js';
import { ownerRouter } from './routers/owner.js';
import { receivingRouter } from './routers/receiving.js';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
});

export type AppRouter = typeof appRouter;
export type { AppContext, AuthedContext, Session } from './context.js';
