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
import { scansRouter } from './routers/scans';
import { searchRouter } from './routers/search';
import { settingsRouter } from './routers/settings';
import { suppliersRouter } from './routers/suppliers';
import { catalogRouter } from './routers/catalog';
import { ordersRouter } from './routers/orders';
import { matchRouter } from './routers/match';
import { mappingRouter } from './routers/mapping';
import { productsRouter } from './routers/products';
import { teamRouter } from './routers/team';

export const appRouter = router({
  owner: ownerRouter,
  receiving: receivingRouter,
  scans: scansRouter,
  onboarding: onboardingRouter,
  approvals: approvalsRouter,
  exports: exportsRouter,
  activity: activityRouter,
  admin: adminRouter,
  settings: settingsRouter,
  plans: plansRouter,
  leads: leadsRouter,
  search: searchRouter,
  suppliers: suppliersRouter,
  catalog: catalogRouter,
  orders: ordersRouter,
  match: matchRouter,
  mapping: mappingRouter,
  products: productsRouter,
  team: teamRouter,
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
  WhatsAppCloudNotifier,
  ResendEmailNotifier,
  makeResendDispatcher,
  createNotifiers,
  createEmailNotifier,
  createWhatsAppNotifier,
  createPushNotifier,
  isResendConfigured,
  isWhatsAppCloudConfigured,
  renderEmail,
  magicLinkEmail,
  inviteEmail,
  supplierDelayEmail,
  orderNotPlacedEmail,
  approvalNeededEmail,
  weeklyLeakReportEmail,
  endOfDayReportEmail,
  recipientsForRestaurant,
  MANAGER_ROLES,
  type RenderedEmail,
  type Recipient,
  type Notifiers,
  type Notifier,
  type NotificationPayload,
  type NotificationChannel,
} from './notifications';
export { logActivity, type ActivityEventInput, type ActivityEventType } from './activity';
export { buildMatchInputForInvoice, type BuiltMatchInput } from './match/buildMatchInput';
export { persistMatchRun, type PersistMatchArgs, type PersistMatchResult } from './match/persist';
export {
  parseCatalogFile,
  autoDetectMapping,
  extractCatalogRows,
  parseNumeric,
  type ParsedTable,
  type CatalogRow,
  type CatalogFileInput,
} from './catalog/parse';
export {
  commitCatalogRows,
  type CommitArgs,
  type CommitResult,
  type AmbiguousRow,
} from './catalog/commit';
export {
  checkRateLimit,
  MemoryRateLimitStore,
  RateLimitError,
  type RateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from './rateLimit';
export { isOriginAllowed, type OriginCheckInput } from './csrf';
export {
  clientIpFromHeaders,
  trpcRequestTargets,
  type HeaderReader,
  type ClientIpOptions,
} from './edge';
export { canonicalizeEmail } from './email';
export { startOfDayInTz, endOfDayInTz, addCalendarDaysInTz } from './lib/time';
