export { computeOwnerKpis, emptyKpis, notZeroShortTwin, type OwnerKpis } from './owner-kpis';
export { computeLeaks, type LeakRow, type ComputeLeaksOptions } from './leaks';
export {
  computeSupplierScorecards,
  type SupplierScorecard,
  type ComputeSupplierScorecardsOptions,
} from './suppliers';
// The leak engine's shared rules, re-exported so inventory purchases (S17) reuse them verbatim.
export { LEAK_EXCLUDED_TYPES, LEAK_FILTER, LIVE_DUPLICATE, isLeakType } from './leak-views';
export { AWAITING_QUESTION_SQL } from './awaiting-question';
export { computeBaselines, type BaselineRow, type ComputeBaselinesOptions } from './baselines';
export {
  HELD_FOR_RECEIPTS_KEY,
  receiptsBeingCountedForScan,
  scanAwaitingCountSql,
  SCAN_RECEIPT_LOOKBACK_HOURS,
} from './awaiting-count';
export {
  computeInvoiceLeak,
  computeLeakBreakdown,
  computeLeakHero,
  type LeakBreakdownInvoice,
  type LeakBreakdownLine,
  type LeakHero,
  type LeakHeroOptions,
} from './leak-hero';
export {
  computeLeakReport,
  parseReportMonth,
  type LeakReport,
  type LeakReportPriceCreepRow,
  type LeakReportStatus,
  type LeakReportSupplierRow,
  type LeakReportTypeRow,
} from './leak-report';
export {
  computeLeakGrouped,
  computeLeakSummary,
  computeLeakTrend,
  computeViewOptions,
  LEAK_SEVERITIES,
  RESOLUTION_STATUSES,
  VIEW_COMPARES,
  VIEW_GROUPS,
  VIEW_PERIODS,
  type LeakGroupRow,
  type LeakTrendPoint,
  type ViewCompare,
  type ViewFilters,
  type ViewGroup,
  type ViewPeriod,
  type ViewSpec,
} from './leak-views';
export {
  aggregateChain,
  computeBranchSnapshot,
  monthOfPeriodEnd,
  shiftMonth,
  supplierMergeKey,
  type BranchMonthPoint,
  type BranchPeriodTotals,
  type BranchSnapshot,
  type BranchSupplierRow,
  type ChainBranchRow,
  type ChainOverview,
  type ChainSupplierRow,
  type ChainTotals,
} from './chain';
export {
  computeBranchPriceLines,
  computePriceDisparities,
  DISPARITY_MIN_IMPACT_ILS,
  DISPARITY_MIN_PCT,
  type BranchPriceLine,
  type BranchPriceLines,
  type DisparityBranchPrice,
  type DisparityLine,
  type DisparityMatchMethod,
  type PriceDisparityRow,
} from './chain-disparity';
// G-14: the decision → ₪-effect table, the leak ledger + money-state partition, the METRICS
// registry, and W3-09's pre-created coverage module.
export {
  DECISION_KEY_SQL,
  DECISION_RULES,
  DISCREPANCY_TYPES,
  MONEY_STATES,
  TOLERATED_SQL,
  effectOf,
  effectSql,
  moneyStateOf,
  type Decision,
  type DecisionKey,
  type Effect,
  type MoneyState,
} from './decisions';
export {
  computeLeakLedger,
  computeLeakPartition,
  heroLeakByInvoice,
  partitionOf,
  type LeakLedgerRow,
  type LeakPartition,
  type PaidSource,
} from './leak-ledger';
export { METRICS, METRIC_IDS, PAID_SOURCE, metricValue, type MetricDef, type MetricId, type MetricValue } from './metrics';
export { emptyCoverage, type Coverage, type CoverageRow } from './coverage';
