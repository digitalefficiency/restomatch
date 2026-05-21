import { router } from './trpc';
import { approvalsRouter } from './routers/approvals';
import { onboardingRouter } from './routers/onboarding';
import { ownerRouter } from './routers/owner';
import { receivingRouter } from './routers/receiving';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
  onboarding: onboardingRouter,
  approvals: approvalsRouter,
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
export {
  evaluateApproval,
  DEFAULT_RULES,
  decisionMessage,
  type ApprovalContext,
  type ApprovalDecision,
  type ApprovalAction,
} from './approvals/engine';
export {
  enqueueNotification,
  MockWhatsAppNotifier,
  MockPushNotifier,
  EmailNotifier,
  type Notifier,
  type NotificationPayload,
  type NotificationChannel,
} from './notifications';
