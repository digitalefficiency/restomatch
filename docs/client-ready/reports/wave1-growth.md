# S15 — Wave 1 growth: free leak check, chain pricing, referrals

Branch `claude/wave1-growth`, draft PR into `claude/client-ready`. Migrations **0054–0055** only.

> **תקציר לבעלים (עברית)**
> - **בדיקת דליפה חינם** (`/leak-check`, עברית + אנגלית): בעל מסעדה מעלה עד 10 חשבוניות (+ מחירון אם יש), ומקבל "נמצאה דליפה של ₪X במדגם שלכם" — כל שקל מקושר לשורה בחשבונית. נספרים רק חיובי-יתר; טעות לטובתו לא מקוזזת ולא נספרת; חשבונית כפולה לא נספרת פעמיים. הקבצים לא נשמרים, התוצאות נמחקות אחרי 7 ימים, והכל רץ בארגז-חול נפרד שאינו מסעדה (טבלאות נפרדות, חסומות לתפקיד המסעדות).
> - הגנות: הוכחת-עבודה (בלי CAPTCHA) + honeypot, הגבלת קצב לפי IP ולפי אימייל, מגבלות גודל וסוג קובץ (נבדק מתוך הבייטים), קישור תוצאות חתום ל-24 שעות, ותקציב יומי לקריאות Claude.
> - **כבוי כברירת מחדל**: עולה רק עם `LEAK_CHECK_PUBLIC=1`. בפרודקשן הוא לא יציג נתוני דוגמה: צריך `LEAK_CHECK_REAL_OCR=1` + מפתח Claude (הוצאה — החלטה שלך), או `LEAK_CHECK_ALLOW_SAMPLE=1` לסביבת דמו בלבד.
> - **תמחור רשתות**: המחירים הקיימים לא השתנו (349/590/1,490). רשת: ₪1,490 כוללים עד 5 סניפים (₪298 לסניף ב-5 סניפים), כל סניף נוסף ₪298. חיוב שנתי = 10 חודשים (חודשיים מתנה). **הפניה**: חודש חינם לשני הצדדים (נרשם כזיכוי "ממתין" — אין חיוב אמיתי). הכל מאחורי דגל, וכל מחיר נבדק באגורות. **החלטה שלך:** לפי COSTS.md ₪298 לסניף = margin של ~69% (שנתי ~63%) — מתחת ליעד 75%. פירוט: `docs/client-ready/growth-pricing-proposal.md`.

## Built

### 1. Free leak check (flag `leakCheck`)

| Piece | Where |
|---|---|
| Sandbox tables `leak_check_sessions`, `leak_check_ocr_usage` (RLS on, **no policies**, REVOKE from `restomatch_app`; `expires_at ≤ created_at + 7 days` CHECK; file bytes never stored; IP stored only as an HMAC) | `packages/db/drizzle/0054_leak_check_sandbox.sql`, `schema.ts` (append) |
| Analysis — duplicate invoice, VAT > 18 %, line/subtotal/total arithmetic, price creep (same supplier, vs first price in the sample), above own price list; integer agorot; overcharges only; one price finding per line; ≤ ₪1 noise ignored | `packages/api/src/leakCheck/analyze.ts` |
| PoW (HMAC-signed challenge, 16 leading zero bits, 10 min, single-use), signed result links (24 h, domain-separated HMAC), magic-byte sniffing, size limits (10 files, 4 MB each, 4.4 MB body), gates | `packages/api/src/leakCheck/security.ts` |
| Orchestration: validate → **daily OCR budget** (atomic upsert, `LEAK_CHECK_DAILY_OCR_CALLS`, default 200) → purge expired → OCR (Claude Vision / `ClaudePoParser` for the price list, or the deterministic sample stub) → analyse → persist | `packages/api/src/leakCheck/service.ts`, `sampleOcr.ts` |
| Public routes `POST /api/leak-check/{challenge,submit,lead}`: gate 404 → same-origin → body cap → per-IP limit (challenge 30/h, submit 5/day, lead 10/h) → honeypot → PoW → per-mailbox limit (3/day, `+tag` collapsed) → uploads → budget | `apps/web/lib/leakCheck/handlers.ts`, `apps/web/app/api/leak-check/*` |
| Pages `/leak-check`, `/leak-check/result?t=` (noindex, no-referrer, sample-mode banner, every finding names invoice + line + file), `/leak-check/claim?t=` (login → owner attaches the result to the restaurant) | `apps/web/app/(marketing)/leak-check/**` (new folder only) |
| Tenant side: `leakCheck.claim` (owner), `leakCheck.claimed` (manager+) — flag-gated `FEATURE_DISABLED`, sandbox read on the owner connection filtered by the caller's restaurant, first claim wins | `packages/api/src/routers/leakCheck.ts` |
| i18n namespace `leakCheck` (he + en) | `apps/web/lib/i18n/messages/leakCheck/` |

**Gate:** page + routes exist only with `LEAK_CHECK_PUBLIC=1` and `FEATURES_OFF` not containing `all`/`leakCheck`. OCR mode: `claude` only with `ANTHROPIC_API_KEY` **and** `LEAK_CHECK_REAL_OCR=1`; sample stub outside production or with `LEAK_CHECK_ALLOW_SAMPLE=1`; otherwise the page shows "book a demo" instead of the form (a real prospect never gets sample numbers silently). Secret: `LEAK_CHECK_SECRET` (falls back to `AUTH_SECRET`).

**Showcase coordination (S2):** this replaces the public walk-in upload in spirit — no storage bucket, no URL fetch, bytes live only in the request. S2's server-side showcase upload is untouched.

### 2. Chain pricing, annual billing, referral (flag `growth`)

Full proposal with every price agorot-exact: **`docs/client-ready/growth-pricing-proposal.md`** (owner review). Summary:

| | Monthly | Annual (10×) | Shown /mo billed annually |
|---|---:|---:|---:|
| basic | 34,900 | 349,000 | 29,083 |
| pro | 59,000 | 590,000 | 49,167 |
| chain 1–5 branches | 149,000 | 1,490,000 | 124,167 |
| chain 6 / 10 branches | 178,800 / 298,000 | 1,788,000 / 2,980,000 | 149,000 / 248,333 |

Per extra branch 29,800. Referral credit = each side's own monthly price, recorded `pending` → `credited` by `creditReferralRedemption()` (owner connection, idempotent; **no caller yet, no money moves**). `PLAN_SEED` unchanged (asserted).

- Code: `packages/billing/src/chainPricing.ts` (+33 tests), `packages/api/src/routers/growth.ts` (`growth.pricing` public pure quote gated by `GROWTH_PRICING_PUBLIC=1`; `myReferral`, `redeemReferral` (first 30 days, once, never self), `referralStats`), migration `0055_referrals.sql` (RLS policies inside the migration + `app.resolve_referral_code` SECURITY DEFINER lookup; app role cannot update/delete ⇒ cannot mint credits), UI `apps/web/lib/growth/{ChainPricing,ChainPricingSection,ReferralCard}.tsx`, i18n namespace `growth`.
- The per-branch figure shown is **what that chain size actually pays** (₪1,490 / 3 = ₪496.67 at 3 branches); ₪298 is labelled as the price at 5 branches. (Caught in layer-2 review — the first draft showed ₪298 at every size.)

### 3. i18n
Namespaces `leakCheck` and `growth` registered in `messages/index.ts`; parity test green.

## Requests to the orchestrator

1. **Nav link (S6):** add `{ href: '/leak-check', label: he "בדיקת דליפה חינם" / en "Free leak check" }` to the marketing header + footer "Product" column — render it only when `LEAK_CHECK_PUBLIC=1` (server check `leakCheck.leakCheckPublicEnabled()` from `@restomatch/api`). A hero secondary CTA "בדקו את החשבוניות שלכם בחינם" → `/leak-check` would also fit.
2. **Pricing page diff (S6 owns it):** `docs/client-ready/reports/wave1-growth-pricing-page.diff` — 4 additive lines (import + `<ChainPricingSection plans={plans} />`). Applied on this branch; drop/reapply at merge as S6 prefers.
3. **ReferralCard mount (S4/S5):** `apps/web/lib/growth/ReferralCard.tsx` on settings/billing with `canRedeem={role==='owner'}`; it renders nothing when the flag is off.
4. **Daily purge job (cron.ts is immutable):** retention is enforced already (purge on every submit + the `expires_at` read filter + the 7-day CHECK), but a daily `purgeExpiredLeakChecks(db)` in the worker is proposed for quiet days.
5. **Onboarding (S4):** `/leak-check/claim` sends a signed-in user without a restaurant to `/onboarding?callbackUrl=…`; onboarding currently ignores `callbackUrl`, so a brand-new owner must reopen the claim link after creating the restaurant. Honour `callbackUrl` there (safe-relative) to make the carry-over one click.

## Owner actions

- `LEAK_CHECK_SECRET` (32+ random chars) in Vercel; `LEAK_CHECK_PUBLIC=1` when ready to launch; for real OCR: `LEAK_CHECK_REAL_OCR=1` + `ANTHROPIC_API_KEY` and a budget `LEAK_CHECK_DAILY_OCR_CALLS` (default 200 calls/day ≈ 20 full checks; ≈ $0.05–0.10 per call ⇒ ≤ ~$20/day worst case). `TRUSTED_PROXY_HOPS=1` on Vercel so per-IP limits key on the real client.
- `GROWTH_PRICING_PUBLIC=1` to show the chain/annual section; `features.growth` per restaurant for referrals.
- Decide on the margin note in the proposal (₪298/branch ≈ 69 %, annual ≈ 63 % vs the 75 % target).

## Immutable files touched (owner review)

- `packages/billing/src/index.ts` (+1 export line) and new `packages/billing/src/chainPricing.ts` — pricing math, behind flags.
- `packages/db/src/schema.ts` (additive: 4 tables), `packages/db/drizzle/meta/_journal.json` (0054, 0055).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts` — additive COVERAGE (`leakCheck.claim/claimed`, `growth.*`) + new attack/isolation blocks; nothing weakened.
- Not touched: `plans.ts`, `leads.ts`, the tRPC route handler, `rateLimit.ts` (used, not modified), `rls.ts`, `drizzle/rls/*`, engine, canary, cron/outbox.

Shared non-immutable files: `packages/api/src/lib/features.ts` (+`growth` key), `errors.ts` (+5 appCodes), `apps/web/lib/serverErrors.ts` (maps them), `apps/web/lib/publicPaths.ts` (+`/leak-check`, `/api/leak-check`, with test), `apps/web/test/appRouterShape.test.ts`, `packages/api/src/index.ts`, `apps/web/lib/i18n/messages/index.ts`, `apps/web/app/(marketing)/pricing/page.tsx` (see diff). `supabase/` — appended by `pnpm db:supabase-sync` only (no released file changed).

## Still not done / follow-ups

- Real-OCR path is wired (ClaudeVision on the bytes, ClaudePoParser for the price list) but exercised only with mocks/stub — no key in this container.
- Carried-over results are attached to the restaurant (`leakCheck.claimed`) but not yet shown on a dashboard card (dashboard pages belong to S3/S5) nor imported as real invoices (needs S2's ingest).
- Referral credits are recorded, never applied to an invoice (no PSP — `NoopBillingProvider`).

## Verification (2 layers)

_(filled below)_
