import { router } from './trpc';
import { activityRouter } from './routers/activity';
import { adminRouter } from './routers/admin';
import { approvalsRouter } from './routers/approvals';
import { exportsRouter } from './routers/exports';
import { leadsRouter } from './routers/leads';
import { onboardingRouter } from './routers/onboarding';
import { ownerRouter } from './routers/owner';
import { plansRouter } from './routers/plans';
import { receivingRouter } from './routers/receiving';
import { searchRouter } from './routers/search';
import { settingsRouter } from './routers/settings';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
  onboarding: onboardingRouter,
  approvals: approvalsRouter,
  exports: exportsRouter,
  activity: activityRouter,
  admin: adminRouter,
  settings: settingsRouter,
  plans: plansRouter,
  leads: leadsRouter,
  search: searchRouter,
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
  adminProcedure,
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
export { clientIpFromHeaders, trpcRequestTargets, type HeaderReader } from './edge';
export { canonicalizeEmail } from './email';
