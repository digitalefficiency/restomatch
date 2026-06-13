import { router } from './trpc';
import { activityRouter } from './routers/activity';
import { approvalsRouter } from './routers/approvals';
import { exportsRouter } from './routers/exports';
import { onboardingRouter } from './routers/onboarding';
import { ownerRouter } from './routers/owner';
import { receivingRouter } from './routers/receiving';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
  onboarding: onboardingRouter,
  approvals: approvalsRouter,
  exports: exportsRouter,
  activity: activityRouter,
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
  requireFeature,
  router,
  userScopedProcedure,
} from './trpc';
export {
  PLAN_SEED,
  PLAN_SEED_LIST,
  getEntitlements,
  getQuota,
  recordUsage,
  meterOcrScan,
  usagePeriod,
  QuotaExceededError,
  type Entitlements,
  type QuotaState,
  type UsageMetric,
  type PlanSeed,
} from './entitlements';
export {
  evaluateApproval,
  buildRules,
  DEFAULT_RULES,
  DEFAULT_APPROVAL_THRESHOLDS,
  resolveApprovalThresholds,
  decisionMessage,
  type ApprovalContext,
  type ApprovalDecision,
  type ApprovalAction,
  type ApprovalThresholds,
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
export { logActivity, type ActivityEventInput, type ActivityEventType } from './activity';
export {
  checkRateLimit,
  MemoryRateLimitStore,
  RateLimitError,
  type RateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from './rateLimit';
export { isOriginAllowed, type OriginCheckInput } from './csrf';
export { canonicalizeEmail } from './email';
