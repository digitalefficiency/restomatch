import 'server-only';
import {
  CHAIN_INCLUDED_BRANCHES,
  chainPerBranchAgorot,
  growthPricingPublicEnabled,
  quotePlan,
  type PlanQuote,
} from '@restomatch/api';
import { ChainPricing, type QuoteView } from './ChainPricing';

/** Branch counts the stepper offers (quotes are pre-computed for each). */
const STEPPER_MAX_BRANCHES = 20;

function view(q: PlanQuote): QuoteView {
  return {
    monthlyAgorot: q.monthlyAgorot,
    chargeAgorot: q.chargeAgorot,
    perMonthDisplayAgorot: q.perMonthDisplayAgorot,
    annualSavingsAgorot: q.annualSavingsAgorot,
  };
}

/**
 * Server wrapper for the pricing page: renders nothing unless
 * GROWTH_PRICING_PUBLIC=1 (and `growth` is not killed by FEATURES_OFF). All ₪
 * math happens here through @restomatch/billing, in integer agorot.
 */
export function ChainPricingSection({
  plans,
  ctaHref = '/#lead',
}: {
  plans: Array<{ key: string; priceAgorotMonthly: number }>;
  ctaHref?: string;
}) {
  if (!growthPricingPublicEnabled()) return null;
  const chainPlan = plans.find((p) => p.key === 'chain');
  if (!chainPlan) return null;
  const both = (key: string) => {
    const p = plans.find((x) => x.key === key);
    return p ? { monthly: view(quotePlan(p, 'monthly')), annual: view(quotePlan(p, 'annual')) } : null;
  };
  const chain = Array.from({ length: STEPPER_MAX_BRANCHES }, (_, i) => ({
    branches: i + 1,
    monthly: view(quotePlan(chainPlan, 'monthly', i + 1)),
    annual: view(quotePlan(chainPlan, 'annual', i + 1)),
  }));
  return (
    <ChainPricing
      chain={chain}
      perBranchAgorot={chainPerBranchAgorot(chainPlan.priceAgorotMonthly)}
      includedBranches={CHAIN_INCLUDED_BRANCHES}
      basic={both('basic')}
      pro={both('pro')}
      ctaHref={ctaHref}
    />
  );
}
