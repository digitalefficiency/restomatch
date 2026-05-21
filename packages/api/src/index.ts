import { router } from './trpc';
import { onboardingRouter } from './routers/onboarding';
import { ownerRouter } from './routers/owner';
import { receivingRouter } from './routers/receiving';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
  onboarding: onboardingRouter,
});

export type AppRouter = typeof appRouter;
export type {
  AppContext,
  AuthedContext,
  MemberContext,
  MemberSession,
  Session,
} from './context';
export {
  authedProcedure,
  bookkeeperProcedure,
  chefProcedure,
  managerProcedure,
  memberProcedure,
  ownerProcedure,
  publicProcedure,
  receiverProcedure,
  router,
} from './trpc';
