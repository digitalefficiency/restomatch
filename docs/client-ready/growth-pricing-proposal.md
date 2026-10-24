# Chain pricing, annual billing and referrals: proposal for owner review (S15, wave 1)

> **תקציר לבעלים (עברית)**
> - **המחירים הקיימים לא זזים:** בסיס ₪349, מקצועי ₪590, רשת ₪1,490 לחודש (לא נגעתי ב-`plans.ts`).
> - **רשת לפי סניף:** ₪1,490 כוללים עד 5 סניפים (₪298 לסניף). מהסניף השישי: ₪298 לכל סניף נוסף בחודש.
> - **חיוב שנתי:** משלמים על 10 חודשים במקום 12 (חודשיים מתנה). למשל, מקצועי: ₪5,900 לשנה, כלומר ₪491.67 לחודש.
> - **חבר מביא חבר:** מסעדה חדשה מממשת קוד (בחודש הראשון שלה, פעם אחת). כל צד מקבל זיכוי של חודש אחד לפי המחיר שלו. **הזיכוי נרשם בלבד, ושום כסף לא זז** (אין עדיין ספק תשלומים). הזיכוי נרשם רק כשהמסעדה המופנית מתחילה לשלם.
> - הכל מאחורי דגל: `GROWTH_PRICING_PUBLIC=1` מציג את הרשת והמתג השנתי בדף המחירים; ההפניות פעילות רק למסעדה עם `features.growth`. כיבוי מיידי: `FEATURES_OFF=growth`.
> - **החלטה שלך:** לפי `COSTS.md` (~$25 תשתית לסניף), ₪298 לסניף נותן margin של כ-69%, וחיוב שנתי כ-63%. שני המספרים מתחת ליעד ה-75%. פירוט בהמשך.

## Rules (implemented in `packages/billing/src/chainPricing.ts`, pure integer agorot)

| # | Rule | Rounding |
|---|---|---|
| 1 | Per-branch figure = chain list price / 5 | half-up to the agora (`divHalfUp`); exact today (149,000 / 5 = 29,800) |
| 2 | Chain monthly = list + max(0, branches − 5) × per-branch | integer, none |
| 3 | Annual charge = 10 × monthly | integer, none |
| 4 | "Per month, billed annually" = annual / 12 | half-up to the agora, integer-only `floor((2a+12)/24)`; **display only**, the charge is rule 3 |
| 5 | Referral credit = the restaurant's own monthly price (chain at its branch count), once per redemption | integer, none |

List prices are passed in from `PLAN_SEED` / the `plans` table and never re-declared, so a price change still lives in one place.

## Every price shown (agorot), all asserted in tests

| Plan | Monthly | Annual (10×) | Per month, billed annually | Annual saving |
|---|---:|---:|---:|---:|
| trial | 0 | 0 | 0 | 0 |
| basic | 34,900 | 349,000 | 29,083 (29,083.33) | 69,800 |
| pro | 59,000 | 590,000 | 49,167 (49,166.67) | 118,000 |
| chain (1–5 branches) | 149,000 | 1,490,000 | 124,167 (124,166.67) | 298,000 |

| Chain branches | Monthly | Annual | Per month, billed annually |
|---:|---:|---:|---:|
| 1–5 | 149,000 | 1,490,000 | 124,167 |
| 6 | 178,800 | 1,788,000 | 149,000 |
| 7 | 208,600 | 2,086,000 | 173,833 |
| 8 | 238,400 | 2,384,000 | 198,667 |
| 9 | 268,200 | 2,682,000 | 223,500 |
| 10 | 298,000 | 2,980,000 | 248,333 |

Per-branch: **29,800** (₪298). Referral credits: trial 0 · basic 34,900 · pro 59,000 · chain 149,000 (6 branches: 178,800).

Tests: `packages/billing/src/__tests__/chainPricing.test.ts` (28 cases) and `packages/api/src/__tests__/growth.test.ts` (the public quote against `PLAN_SEED`, plus the credit flow).

## Leak-economist sanity check

- **Chain value:** a 3-branch chain buying about ₪700k a month leaks about ₪10,500 at the 1.5% North-Star rate (GTM §5), against a ₪1,490 subscription (about 14%). At 7 branches buying about ₪1.6M, the leak is about ₪24k against ₪2,086 (about 9%). The price stays well under the 15–25% value anchor, so it is **not** an inflated claim. These leak figures are targets, not measured results.
- **Margin (flag for the owner):** `docs/COSTS.md` puts variable infra at about $25 per restaurant. At an assumed ₪3.7/$, that is about ₪92.5 per branch.
  - Per-branch ₪298 gives about 69% gross margin.
  - Annual billing (₪248.33 per branch per month) gives about 63%.
  - Both are **below the 75% target**. The ₪298-per-branch economics are already implied by today's ₪1,490 for 5 restaurants. The new part is that a chain can now go *above* 5 branches at that rate.
  - Options:
    - (a) accept it; fixed costs amortize as COSTS.md notes;
    - (b) price extra branches at ₪349 (= basic);
    - (c) restrict the annual discount to the plan's base price.
  - Owner decision; changing it is a single constant.
- **Referral cost:** at most one month of each side's price per new paying customer, and only once the referred restaurant pays (status `pending` until then). That costs less than one month of the GTM CAC budget.

## Flags and safety

- Public pricing section: `GROWTH_PRICING_PUBLIC=1`, killed by `FEATURES_OFF=all|growth` (`growthPricingPublicEnabled`).
- Referral procedures: per-restaurant `features.growth`. When it is off they throw FORBIDDEN with appCode `FEATURE_DISABLED`.
- No payments: the referral flow writes `referral_redemptions` rows only. `creditReferralRedemption()` (owner/service connection) fills both credits, is idempotent, and has no caller yet. Wiring it to "first paid invoice" belongs with the billing provider integration (Grow).
- RLS (migration 0055):
  - A tenant sees only its own code.
  - A redemption is visible to its referrer and its referred restaurant only.
  - The app role can only INSERT a `pending` row naming itself as referred and the code's true referrer. That referrer is resolved by `app.resolve_referral_code`, a SECURITY DEFINER function.
  - The app role cannot UPDATE or DELETE redemptions, so a compromised tenant path cannot mint credits.

## Immutable files touched (human review)

- `packages/billing/src/chainPricing.ts` (new) and `packages/billing/src/index.ts` (one re-export line): pricing math.
- `packages/db/src/schema.ts`: additive `referralCodes`, `referralRedemptions`.
- `packages/db/drizzle/meta/_journal.json`: the 0055 entry.
- `packages/api/src/__tests__/cross-tenant.attack.test.ts`: 4 COVERAGE entries and the `growth.*` block (additive).
- `apps/web/app/(marketing)/pricing/page.tsx` (S6-owned, not on the immutable list): a 4-line additive diff in `docs/client-ready/reports/wave1-growth-pricing-page.diff`.
- `packages/db/src/plans.ts` is **not** touched.
