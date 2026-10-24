import { describe, expect, it } from 'vitest';
import {
  annualAgorot,
  annualMonthlyEquivalentAgorot,
  annualSavingsAgorot,
  chainMonthlyAgorot,
  chainPerBranchAgorot,
  divHalfUp,
  quotePlan,
  referralCreditAgorot,
} from '../chainPricing';

/**
 * Agorot-exact assertions for EVERY price the pricing page / referral flow can
 * show. The list prices are the current PLAN_SEED values (packages/db/src/plans.ts)
 * — asserted literally so a silent list-price change fails here too
 * (packages/api growth tests assert the same numbers against PLAN_SEED itself).
 */
const LIST = { trial: 0, basic: 34_900, pro: 59_000, chain: 149_000 } as const;

describe('half-up integer division', () => {
  it('rounds .5 up and below .5 down, integer-only', () => {
    expect(divHalfUp(6, 12)).toBe(1); // 0.5 → 1
    expect(divHalfUp(5, 12)).toBe(0); // 0.4166 → 0
    expect(divHalfUp(18, 12)).toBe(2); // 1.5 → 2
    expect(divHalfUp(0, 12)).toBe(0);
    expect(() => divHalfUp(1.5, 12)).toThrow(RangeError);
    expect(() => divHalfUp(-1, 12)).toThrow(RangeError);
    expect(() => divHalfUp(1, 0)).toThrow(RangeError);
  });
});

describe('monthly list prices (unchanged)', () => {
  it.each([
    ['trial', 0],
    ['basic', 34_900],
    ['pro', 59_000],
    ['chain', 149_000],
  ] as const)('%s monthly = %i agorot', (key, agorot) => {
    const q = quotePlan({ key, priceAgorotMonthly: LIST[key] }, 'monthly');
    expect(q.monthlyAgorot).toBe(agorot);
    expect(q.chargeAgorot).toBe(agorot);
    expect(q.perMonthDisplayAgorot).toBe(agorot);
  });
});

describe('annual billing = 10 × monthly (two months free)', () => {
  it.each([
    // key, annual, per-month display (annual/12 half-up), savings
    ['trial', 0, 0, 0],
    ['basic', 349_000, 29_083, 69_800], // 29,083.33 → 29,083
    ['pro', 590_000, 49_167, 118_000], // 49,166.67 → 49,167
    ['chain', 1_490_000, 124_167, 298_000], // 124,166.67 → 124,167
  ] as const)('%s: annual %i, per-month %i, saves %i', (key, annual, perMonth, savings) => {
    const monthly = LIST[key];
    expect(annualAgorot(monthly)).toBe(annual);
    expect(annualMonthlyEquivalentAgorot(monthly)).toBe(perMonth);
    expect(annualSavingsAgorot(monthly)).toBe(savings);
    const q = quotePlan({ key, priceAgorotMonthly: monthly }, 'annual');
    expect(q.chargeAgorot).toBe(annual);
    expect(q.perMonthDisplayAgorot).toBe(perMonth);
    expect(q.annualSavingsAgorot).toBe(savings);
  });
});

describe('chain per-branch', () => {
  it('per-branch figure = ₪1,490 / 5 = ₪298.00', () => {
    expect(chainPerBranchAgorot(LIST.chain)).toBe(29_800);
  });

  it.each([
    // branches, monthly, annual, per-month display (annual)
    [1, 149_000, 1_490_000, 124_167],
    [2, 149_000, 1_490_000, 124_167],
    [3, 149_000, 1_490_000, 124_167],
    [4, 149_000, 1_490_000, 124_167],
    [5, 149_000, 1_490_000, 124_167],
    [6, 178_800, 1_788_000, 149_000],
    [7, 208_600, 2_086_000, 173_833], // 173,833.33 → 173,833
    [8, 238_400, 2_384_000, 198_667], // 198,666.67 → 198,667
    [9, 268_200, 2_682_000, 223_500],
    [10, 298_000, 2_980_000, 248_333], // 248,333.33 → 248,333
  ] as const)('%i branches: %i/mo, %i/yr, %i/mo billed annually', (branches, monthly, annual, perMonth) => {
    expect(chainMonthlyAgorot(LIST.chain, branches)).toBe(monthly);
    const m = quotePlan({ key: 'chain', priceAgorotMonthly: LIST.chain }, 'monthly', branches);
    expect(m.monthlyAgorot).toBe(monthly);
    expect(m.perBranchAgorot).toBe(29_800);
    const a = quotePlan({ key: 'chain', priceAgorotMonthly: LIST.chain }, 'annual', branches);
    expect(a.chargeAgorot).toBe(annual);
    expect(a.perMonthDisplayAgorot).toBe(perMonth);
  });

  it('rejects nonsense branch counts', () => {
    expect(() => chainMonthlyAgorot(LIST.chain, 0)).toThrow(RangeError);
    expect(() => chainMonthlyAgorot(LIST.chain, 2.5)).toThrow(RangeError);
    expect(() => chainMonthlyAgorot(LIST.chain, 51)).toThrow(RangeError);
  });

  it('single-venue plans ignore the branch count', () => {
    const q = quotePlan({ key: 'pro', priceAgorotMonthly: LIST.pro }, 'monthly', 7);
    expect(q.branches).toBe(1);
    expect(q.monthlyAgorot).toBe(59_000);
    expect(q.perBranchAgorot).toBeNull();
  });
});

describe('referral credit = one month of the restaurant’s own price', () => {
  it.each([
    [0, 0],
    [34_900, 34_900],
    [59_000, 59_000],
    [149_000, 149_000],
    [178_800, 178_800], // 6-branch chain
  ])('monthly %i → credit %i', (monthly, credit) => {
    expect(referralCreditAgorot(monthly)).toBe(credit);
  });

  it('rejects fractional agorot', () => {
    expect(() => referralCreditAgorot(100.5)).toThrow(RangeError);
  });
});
