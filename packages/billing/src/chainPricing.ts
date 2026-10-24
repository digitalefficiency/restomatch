/**
 * Chain per-branch pricing, annual billing and referral credits (wave 1, S15).
 *
 * PROPOSAL CODE — human-reviewed money file. Pure integer-agorot math; no
 * function here changes a plan's list price. The monthly list prices stay the
 * ones in `PLAN_SEED` (packages/db/src/plans.ts) and are passed in, never
 * re-declared, so a price change still happens in exactly one place.
 *
 * Rules (every rounding step is explicit):
 *  1. Chain includes up to CHAIN_INCLUDED_BRANCHES (5) branches at the chain
 *     list price. The per-branch figure shown is listPrice / 5, rounded HALF-UP
 *     to the agora (₪1,490 / 5 = ₪298.00 exactly — no rounding needed today).
 *  2. Each branch beyond 5 costs that same per-branch figure per month.
 *     Total = listPrice + (branches − 5) × perBranch — integer, no rounding.
 *  3. Annual billing = 10 × monthly (two months free). Integer, no rounding.
 *  4. The "per month, billed annually" figure = annual / 12, rounded HALF-UP to
 *     the agora (Math.floor((2a + 12) / 24) on integers — no float division).
 *     It is DISPLAY ONLY; the amount charged is the annual integer.
 *  5. Referral = one month free for both sides: each side is credited ITS OWN
 *     monthly price (for a chain, at its current branch count) once per
 *     redemption. A trial restaurant (price 0) earns a 0 credit until it is on a
 *     paid plan — credits are recorded, never charged/paid out (no PSP yet).
 */

export const CHAIN_INCLUDED_BRANCHES = 5;
export const ANNUAL_BILLED_MONTHS = 10;
export const MONTHS_PER_YEAR = 12;
export const MAX_CHAIN_BRANCHES = 50;

function assertAgorot(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer number of agorot`);
  }
}

function assertBranches(branches: number): void {
  if (!Number.isSafeInteger(branches) || branches < 1 || branches > MAX_CHAIN_BRANCHES) {
    throw new RangeError(`branches must be an integer in 1..${MAX_CHAIN_BRANCHES}`);
  }
}

/** Integer division rounded half-up (both operands non-negative integers). */
export function divHalfUp(numerator: number, denominator: number): number {
  assertAgorot(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('denominator must be a positive integer');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Rule 1: the chain per-branch price (agorot / month). */
export function chainPerBranchAgorot(chainListAgorotMonthly: number): number {
  assertAgorot(chainListAgorotMonthly, 'chainListAgorotMonthly');
  return divHalfUp(chainListAgorotMonthly, CHAIN_INCLUDED_BRANCHES);
}

/** Rule 2: monthly total for a chain with `branches` branches (agorot). */
export function chainMonthlyAgorot(chainListAgorotMonthly: number, branches: number): number {
  assertAgorot(chainListAgorotMonthly, 'chainListAgorotMonthly');
  assertBranches(branches);
  const extra = Math.max(0, branches - CHAIN_INCLUDED_BRANCHES);
  return chainListAgorotMonthly + extra * chainPerBranchAgorot(chainListAgorotMonthly);
}

/** Rule 3: annual price = 10 × monthly (agorot). */
export function annualAgorot(monthlyAgorot: number): number {
  assertAgorot(monthlyAgorot, 'monthlyAgorot');
  return monthlyAgorot * ANNUAL_BILLED_MONTHS;
}

/** Rule 4: display-only monthly equivalent of an annual price (agorot, half-up). */
export function annualMonthlyEquivalentAgorot(monthlyAgorot: number): number {
  return divHalfUp(annualAgorot(monthlyAgorot), MONTHS_PER_YEAR);
}

/** What annual billing saves vs 12 monthly payments (agorot). */
export function annualSavingsAgorot(monthlyAgorot: number): number {
  assertAgorot(monthlyAgorot, 'monthlyAgorot');
  return monthlyAgorot * MONTHS_PER_YEAR - annualAgorot(monthlyAgorot);
}

/** Rule 5: one month free — the credit equals the restaurant's own monthly price. */
export function referralCreditAgorot(ownMonthlyAgorot: number): number {
  assertAgorot(ownMonthlyAgorot, 'ownMonthlyAgorot');
  return ownMonthlyAgorot;
}

export type BillingCycle = 'monthly' | 'annual';

export interface PlanPriceInput {
  key: string;
  priceAgorotMonthly: number;
}

export interface PlanQuote {
  key: string;
  cycle: BillingCycle;
  /** Branch count the quote is for (1 for single-venue plans). */
  branches: number;
  monthlyAgorot: number;
  /** Amount charged per billing period: monthly, or the annual lump sum. */
  chargeAgorot: number;
  /** Display-only per-month figure (= monthly, or annual/12 half-up). */
  perMonthDisplayAgorot: number;
  /** Chain only: the per-branch figure; null otherwise. */
  perBranchAgorot: number | null;
  annualSavingsAgorot: number;
}

/** Quote one plan for a cycle (and, for chain, a branch count). */
export function quotePlan(plan: PlanPriceInput, cycle: BillingCycle, branches = 1): PlanQuote {
  const isChain = plan.key === 'chain';
  const effectiveBranches = isChain ? branches : 1;
  const monthly = isChain
    ? chainMonthlyAgorot(plan.priceAgorotMonthly, effectiveBranches)
    : (assertAgorot(plan.priceAgorotMonthly, 'priceAgorotMonthly'), plan.priceAgorotMonthly);
  return {
    key: plan.key,
    cycle,
    branches: effectiveBranches,
    monthlyAgorot: monthly,
    chargeAgorot: cycle === 'annual' ? annualAgorot(monthly) : monthly,
    perMonthDisplayAgorot: cycle === 'annual' ? annualMonthlyEquivalentAgorot(monthly) : monthly,
    perBranchAgorot: isChain ? chainPerBranchAgorot(plan.priceAgorotMonthly) : null,
    annualSavingsAgorot: annualSavingsAgorot(monthly),
  };
}
