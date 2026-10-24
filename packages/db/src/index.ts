export * from './schema';
export { createDb, dbPoolMax, withRestaurant, withUser, type Database } from './client';
export {
  applyCoreTenantRls,
  applyStorageRls,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  ensureRlsAppRole,
} from './rls';
export { PLAN_SEED, PLAN_SEED_LIST, type PlanSeed } from './plans';
export { testDbUrl, DEFAULT_TEST_DB_URL } from './test-env';
export { runCutoverChecks, formatCheckTable, type CheckResult } from './cutoverChecks';
export {
  assertSeedTarget,
  isLocalDbUrl,
  LOCAL_DB_HOSTS,
  PRODUCTION_DB_MARKERS,
  seedTargetProblem,
  supabaseProjectRef,
} from './seedGuard';
export {
  DEMO_EMAIL_DOMAIN,
  DEMO_MAIN_BUSINESS_ID,
  DEMO_BRANCH_NAMES,
  DEMO_MAIN_NAME,
  deleteDemoTenants,
  demoTenantRowCounts,
  findDemoTenants,
  type DemoTenants,
} from './demoTenants';
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
