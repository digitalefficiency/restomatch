import { receiverLangsRouter } from './routers/receiverLangs';
import { askRouter } from './routers/ask';
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
import { dsrRouter } from './routers/dsr';
import { ordersRouter } from './routers/orders';
import { matchRouter } from './routers/match';
import { mappingRouter } from './routers/mapping';
import { productsRouter } from './routers/products';
import { recipesRouter } from './routers/recipes';
import { inventoryRouter } from './routers/inventory';
import { teamRouter } from './routers/team';
import { chainRouter } from './routers/chain';
import { consolidatedRouter } from './routers/consolidated';
import { payRunRouter } from './routers/payRun';
import { contractsRouter } from './routers/contracts';
import { priceAlertsRouter } from './routers/priceAlerts';
import { recoveryRouter } from './routers/recovery';
import { monthlyReportRouter } from './routers/monthlyReport';
import { ingestRouter } from './routers/ingest';
import { leakCheckRouter } from './routers/leakCheck';
import { growthRouter } from './routers/growth';
import { integrationsRouter } from './routers/integrations';
import { supplierConfirmRouter } from './routers/supplierConfirm';
// Pre-registered, still empty (W1-04): later waves own these files, not this one.
import { invoicesRouter } from './routers/invoices';
import { tasksRouter } from './routers/tasks';
import { navRouter } from './routers/nav';
import { pushRouter } from './routers/push';
import { closeRouter } from './routers/close';

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
  recipes: recipesRouter,
  inventory: inventoryRouter,
  chain: chainRouter,
  integrations: integrationsRouter,
  consolidated: consolidatedRouter,
  payRun: payRunRouter,
  team: teamRouter,
  dsr: dsrRouter,
  contracts: contractsRouter,
  priceAlerts: priceAlertsRouter,
  recovery: recoveryRouter,
  monthlyReport: monthlyReportRouter,
  ingest: ingestRouter,
  receiverLangs: receiverLangsRouter,
  ask: askRouter,
  growth: growthRouter,
  leakCheck: leakCheckRouter,
  supplierConfirm: supplierConfirmRouter,
  invoices: invoicesRouter,
  tasks: tasksRouter,
  nav: navRouter,
  push: pushRouter,
  close: closeRouter,
});

export type AppRouter = typeof appRouter;
export type { ConsolidatedProposal, DeliveryNoteCoverage } from './match/consolidated';
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
  passwordResetEmail,
  inviteEmail,
  supplierDelayEmail,
  orderNotPlacedEmail,
  approvalNeededEmail,
  weeklyLeakReportEmail,
  endOfDayReportEmail,
  recipientsForRestaurant,
  MANAGER_ROLES,
  type RenderedEmail,
  type EmailLocale,
  type Recipient,
  type Notifiers,
  type Notifier,
  type NotificationPayload,
  type NotificationChannel,
  type EmailAttachment,
} from './notifications';
export { logActivity, type ActivityEventInput, type ActivityEventType } from './activity';
export { buildMatchInputForInvoice, type BuiltMatchInput } from './match/buildMatchInput';
export {
  invoicesWaitingOnReceipt,
  lockReceipt,
  readScanGrId,
  receiptState,
  receiptStillOpen,
  rematchHoldReason,
  scanOwnerReceipt,
  scanReceiptToStamp,
  scannedInvoicesForReceipt,
  withScanGrId,
} from './receiving/matchTriggers';
export { backfillPriceHistory, writePriceHistoryForInvoice } from './match/priceHistory';
export { loadPriorDecisions, matchActivitySummary, persistMatchRun, type PersistMatchArgs, type PersistMatchResult } from './match/persist';
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
  resetRateLimit,
  MemoryRateLimitStore,
  RateLimitError,
  type RateLimitStore,
  type RateLimitOptions,
  type RateLimitResult,
} from './rateLimit';
export {
  runRetention,
  DEFAULT_RETENTION_CONFIG,
  type RetentionConfig,
  type RetentionReport,
} from './retention';
export { isOriginAllowed, type OriginCheckInput } from './csrf';
export {
  clientIpFromHeaders,
  trpcRequestTargets,
  type HeaderReader,
  type ClientIpOptions,
} from './edge';
export { canonicalizeEmail } from './email';
export { startOfDayInTz, endOfDayInTz, addCalendarDaysInTz } from './lib/time';
export {
  deliveryState,
  latestReceiptStatusSql,
  localDaysBetween,
  poDeliveryStateSql,
  LATE_GRACE_MS,
  type DeliveryState,
  type DeliveryStateInput,
} from './lib/deliveryState';
export { FEATURE_KEYS, featureEnabled, type FeatureKey } from './lib/features';
export { assertFeature } from './lib/featureGate';
export {
  contractInForce,
  contractPriceInUnit,
  isOverContract,
  localDateKey,
  type ContractRow,
} from './contracts/core';
export { applyContractPrices, loadContractsInForce } from './contracts/load';
export { findOverContractLines, type OverContractLine } from './contracts/overContract';
export {
  autoDetectContractMapping,
  commitContractRows,
  extractContractRows,
  parseDateCell,
  type ContractColumnMapping,
  type ContractImportRow,
} from './contracts/import';
export { runPriceAlertSweep, loadAlertDetails, type SweepResult, type PriceAlertDetail } from './priceAlerts/sweep';
export {
  detectSustainedIncrease,
  resolveThreshold,
  cheaperOffer,
  DEFAULT_THRESHOLD_PCT,
  DEFAULT_WINDOW_DAYS,
} from './priceAlerts/detect';
export { priceAlertEmail } from './priceAlerts/email';
export * as leakCheck from './leakCheck';
export {
  confirmationLink,
  createSupplierLink,
  hashSupplierToken,
  loadSupplierOrder,
  resolveSupplierToken,
  submitSupplierAnswer,
  supplierLinkUrl,
  supplierResponseDiff,
  LINK_TTL_MS,
  type ResolvedLink,
  type SupplierOrderView,
  type SupplierAnswerInput,
  type SubmitError,
  type SupplierLinkError,
  type SupplierResponseDiff,
} from './supplierConfirm/service';
export {
  supplierConfirmDocumentExtension,
  supplierAppBaseUrl,
  SUPPLIER_CONFIRM_DOC_LINE_HE,
  SUPPLIER_CONFIRM_DOC_PREVIEW_HE,
  type SupplierConfirmDocumentContext,
} from './supplierConfirm/documentExtension';
export {
  APP_ERROR_CODES,
  AppErrorCause,
  appError,
  isAppErrorCode,
  resolveAppError,
  type AppErrorCode,
  type AppErrorParams,
} from './errors';
export {
  fillEnglishNames,
  fillCatalogEnglish,
  receivingTranslator,
  type FillEnglishResult,
} from './receiving/english';
export { devOcrStubEnabled, buildDevOcrStub } from './receiving/devOcrStub';
export { isAllowedScanUrl } from './lib/scanUrls';
export {
  localScanStorageEnabled,
  readLocalScan,
  readLocalScanMeta,
  scanIdFromLocalUrl,
  isLocalScanId,
} from './lib/localScanStorage';
export { getServiceStorageClient } from './lib/supabaseStorage';
export {
  uploadShowcaseScan,
  validateShowcaseFile,
  isShowcaseScanUrl,
  showcaseScanFetchUrl,
  SHOWCASE_MAX_BYTES,
  type ShowcaseUploadResult,
  type ShowcaseUploadError,
} from './lib/showcaseUpload';
export {
  growthPricingPublicEnabled,
  creditReferralRedemption,
  restaurantMonthlyPriceAgorot,
  REFERRAL_REDEEM_WINDOW_DAYS,
} from './routers/growth';
export {
  quotePlan,
  chainPerBranchAgorot,
  CHAIN_INCLUDED_BRANCHES,
  MAX_CHAIN_BRANCHES as MAX_PRICED_CHAIN_BRANCHES,
  type BillingCycle,
  type PlanQuote,
} from '@restomatch/billing';
export {
  MAX_CHAIN_BRANCHES,
  type ChainBranch,
  type ChainBranchesResult,
  type ChainOverviewResult,
} from './routers/chain';
// Wave 1 · S12 — ₪-back tracker + monthly report.
export { isFeatureOn, assertFeatureOn } from './lib/featureGate';
export {
  syncClaims,
  listClaims,
  summarize as summarizeRecovery,
  computeRecoverySummary,
  returnedInMonth,
  transitionClaim,
  recordCreditNote,
  creditLineSuggestions,
  OVERDUE_DAYS,
  type RecoveryClaimRow,
  type RecoverySummary,
  type RecoverySupplierRow,
  type CreditLineSuggestion,
} from './recovery/service';
export { RECOVERY_TRANSITIONS, canTransition, allocateCredit, ageingBucket } from './recovery/lifecycle';
export { enqueueRecoveryReminders, recoveryReminderEmail } from './recovery/reminders';
export {
  computeMonthlyReport,
  ensureMonthlyReport,
  monthlyReportEmail,
  monthlyReportWhatsApp,
  previousMonthKey,
  type MonthlyReportData,
} from './reports/monthly';
export { renderMonthlyReportPdf } from './reports/pdf';
export { sendMonthlyReports } from './reports/send';
export { formatIlsAgorot } from './reports/money';
export {
  handleEmailWebhook,
  handleWhatsAppVerify,
  handleWhatsAppWebhook,
  INGEST_CHANNEL_LIMIT,
  INGEST_IP_LIMIT,
  type IngestHttpDeps,
} from './ingest/http';
export { processInboundMessage, resolveIngestChannel } from './ingest/pipeline';
export { localNames, renderSizeSuffix, __setReceiverTranslator } from './receiving/localize';
export {
  runAsk,
  setAskBurstLimiter,
  ASK_BURST_LIMIT,
  __setAskClient,
  __resetAskBurst,
  type AskBurstLimiter,
  type AskResult,
} from './ask';
export { NOT_BILLING_OWNER } from './routers/chain';

export * from './ledger';
export { CLAIMABLE_STATUSES, claimableLines, sumClaims, vatBasisOf, type ClaimLine, type VatBasis } from './lib/claims';
export type { PayRunInvoice, PayRunResult, PayRunStatus, PayRunSupplier, PayRunClaim } from './routers/payRun';
export { SKIPPED_NO_PROVIDER, providerConfigured, supplierMessageState, type SupplierMessageState } from './notifications/delivery';
