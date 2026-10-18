# S15 — Wave 1 growth: free leak check, chain pricing, referrals

Branch `claude/wave1-growth`, draft PR into `claude/client-ready`. Migrations **0054–0055** only.

> **תקציר לבעלים (עברית)**
> - **בדיקת דליפה חינם** (`/leak-check`, עברית + אנגלית): בעל מסעדה מעלה עד 10 חשבוניות (+ מחירון אם יש), ומקבל "נמצאה דליפה של ₪X במדגם שלכם" — כל שקל מקושר לחשבונית (ולשורה) שממנה הגיע. נספרים רק חיובי-יתר; טעות לטובתו לא מקוזזת; חשבונית שנראית כפולה **לא נספרת** (מוצגת בנפרד כ"₪X בסיכון אם שולמה פעמיים") — כי שני צילומים של אותה חשבונית נראים בדיוק כמו כפילות. הקבצים לא נשמרים, התוצאות נמחקות אחרי 7 ימים, והכל רץ בארגז-חול נפרד שאינו מסעדה (טבלאות נפרדות, חסומות לתפקיד המסעדות).
> - הגנות: הוכחת-עבודה (בלי CAPTCHA) + honeypot, הגבלת קצב לפי IP ולפי אימייל, מגבלות גודל וסוג קובץ (נבדק מתוך הבייטים), קישור תוצאות חתום ל-24 שעות, ותקציב יומי לקריאות Claude.
> - **כבוי כברירת מחדל**: עולה רק עם `LEAK_CHECK_PUBLIC=1`. בפרודקשן הוא לא יציג נתוני דוגמה: צריך `LEAK_CHECK_REAL_OCR=1` + מפתח Claude (הוצאה — החלטה שלך), או `LEAK_CHECK_ALLOW_SAMPLE=1` לסביבת דמו בלבד.
> - **תמחור רשתות**: המחירים הקיימים לא השתנו (349/590/1,490). רשת: ₪1,490 כוללים עד 5 סניפים (₪298 לסניף ב-5 סניפים), כל סניף נוסף ₪298. חיוב שנתי = 10 חודשים (חודשיים מתנה). **הפניה**: חודש חינם לשני הצדדים (נרשם כזיכוי "ממתין" — אין חיוב אמיתי). הכל מאחורי דגל, וכל מחיר נבדק באגורות. **החלטה שלך:** לפי COSTS.md ₪298 לסניף = margin של ~69% (שנתי ~63%) — מתחת ליעד 75%. פירוט: `docs/client-ready/growth-pricing-proposal.md`.

## Built

### 1. Free leak check (flag `leakCheck`)

| Piece | Where |
|---|---|
| Sandbox tables `leak_check_sessions`, `leak_check_ocr_usage` (RLS on, **no policies**, REVOKE from `restomatch_app`; `expires_at ≤ created_at + 7 days` CHECK; file bytes never stored; IP stored only as an HMAC) | `packages/db/drizzle/0054_leak_check_sandbox.sql`, `schema.ts` (append) |
| Analysis — VAT > 18 %, line arithmetic, total > subtotal + VAT, price creep (same supplier, vs first price in the sample), above own price list; integer agorot; overcharges only; one price finding per line; ≤ ₪1 noise ignored; negative (return) lines skipped. **Notes, never counted:** possible duplicate (same supplier + number — shown with its ₪ at risk), subtotal above Σ lines (fees), same file twice, undercharges | `packages/api/src/leakCheck/analyze.ts` |
| PoW (HMAC-signed challenge, 16 leading zero bits, 10 min, single-use), signed result links (24 h, domain-separated HMAC), magic-byte sniffing, size limits (10 files, 4 MB each, 4.4 MB body), gates | `packages/api/src/leakCheck/security.ts` |
| Orchestration: validate → **daily OCR budget** (atomic upsert, `LEAK_CHECK_DAILY_OCR_CALLS`, default 200) → purge expired → OCR (Claude Vision / `ClaudePoParser` for the price list, or the deterministic sample stub) → analyse → persist | `packages/api/src/leakCheck/service.ts`, `sampleOcr.ts` |
| Public routes `POST /api/leak-check/{challenge,submit,lead}`: gate 404 → **production fails closed (503) unless `TRUSTED_PROXY_HOPS` is set** (else per-IP limits key on a spoofable XFF) → same-origin → content-length **required** (411; chunked bodies refused) + cap (413) → per-IP limit (challenge 30/h, submit 5/day, lead 10/h) → **site-wide 40 submits/h** → honeypot → PoW → per-mailbox limit (3/day, `+tag` collapsed) → uploads → budget | `apps/web/lib/leakCheck/handlers.ts`, `apps/web/app/api/leak-check/*` |
| Pages `/leak-check`, `/leak-check/result?t=` (noindex, no-referrer, sample-mode banner, every finding names invoice + line + file), `/leak-check/claim?t=` (login → owner **confirms with a POST** — a GET never changes anything — and the account email must match the email the check was run with) | `apps/web/app/(marketing)/leak-check/**` (new folder only) |
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

- Code: `packages/billing/src/chainPricing.ts` (+33 tests), `packages/api/src/routers/growth.ts` (`growth.pricing` public pure quote gated by `GROWTH_PRICING_PUBLIC=1`; `myReferral`, `redeemReferral` (first 30 days, once, never self, **never a restaurant that shares a member with the referrer, never an A↔B swap**), `referralStats`), migration `0055_referrals.sql` (RLS policies inside the migration + `app.resolve_referral_code` SECURITY DEFINER lookup; app role cannot update/delete ⇒ cannot mint credits), UI `apps/web/lib/growth/{ChainPricing,ChainPricingSection,ReferralCard}.tsx`, i18n namespace `growth`.
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

- `LEAK_CHECK_SECRET` (32+ random chars) and **`TRUSTED_PROXY_HOPS=1`** (required — the leak check refuses to run in production without it) in Vercel; `LEAK_CHECK_PUBLIC=1` when ready to launch; for real OCR: `LEAK_CHECK_REAL_OCR=1` + `ANTHROPIC_API_KEY` and a budget `LEAK_CHECK_DAILY_OCR_CALLS` (default 200 calls/day ≈ 20 full checks; ≈ $0.05–0.10 per call ⇒ ≤ ~$20/day worst case).
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

## Cross-QA by S4 (security) — fixes

| # | Finding | Fix | Test |
|---|---|---|---|
| W1 (medium) | The site-wide 40/h submit cap ran **before** the proof of work, so 40 junk POSTs (8 IPs × 5) locked every real prospect out for an hour | Cap moved to just before `runLeakCheck`, after the valid single-use PoW, honeypot and per-IP / per-mailbox limits | `leakCheck.attack.test.ts` › "requests WITHOUT a solved proof of work never consume the site-wide cap" (45 unsolved POSTs → 403 each, then a real one → 200; fails on the previous order, passes now) |
| W3 (low) | `dump.rdb` (a local Redis snapshot, already in `.gitignore`) was modified in the PR | `git rm --cached dump.rdb` — untracked, stays ignored | — |
| W4 (low) | Expired sandbox rows were purged only on the next submit | `purgeExpiredLeakChecks(db)` is the standalone, idempotent purge (exported from `@restomatch/api` → `leakCheck`); the read path already hides expired rows and a CHECK caps retention at 7 days. **Scheduling stays a follow-up** — `apps/worker/src/cron.ts` is immutable: proposed daily job `purgeExpiredLeakChecks(ownerDb)` | `leakCheck.test.ts` › "expired sessions are purged and unreadable" (now also asserts a second run deletes 0) |
| W2 (low) | `provision-rls` re-applies the blanket `grant … on all tables` to `restomatch_app`, undoing the REVOKEs in 0054/0055 | **Not changed** (`packages/db/src/rls.ts` is immutable). Isolation still holds: RLS is on with no policy on the sandbox tables (verified: the app role reads/writes 0 rows), and 0055's policies have no UPDATE/DELETE path. **Proposal for the owner** — append to `rlsAppRoleGrantsSql()`: `do $$ begin if to_regclass('public.leak_check_sessions') is not null then execute 'revoke all on leak_check_sessions, leak_check_ocr_usage from restomatch_app'; end if; if to_regclass('public.referral_redemptions') is not null then execute 'revoke update, delete on referral_redemptions, referral_codes from restomatch_app'; end if; end $$;` (same guarded pattern as the credential tables), so privileges and RLS both deny | existing RLS probes in `leakCheck.test.ts` / `growth.test.ts` |

Re-verified after these fixes: layer 1 full gate exit 0 (api 540, web 214, matching 86, db 63, billing 33 …; typecheck 17/17; web tsc + lint 0 errors; supabase-sync up to date); layer 2 prod build + Playwright he/en 28/28.

## Verification (2 layers)

### Layer 1 — full gate (final head)

```bash
export DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test
pnpm install --frozen-lockfile && pnpm exec turbo run test --concurrency=1 && pnpm exec turbo run typecheck \
  && pnpm --filter @restomatch/web exec tsc --noEmit -p . && pnpm --filter @restomatch/web lint && pnpm db:supabase-sync --check
cd apps/web && set -a && . ./.env.local && set +a && LEAK_CHECK_PUBLIC=1 GROWTH_PRICING_PUBLIC=1 LEAK_CHECK_ALLOW_SAMPLE=1 pnpm build
```

Result: **exit 0**. api 540 ✓ · web 213 ✓ · matching 86 ✓ (leak-canary unchanged) · db 63 ✓ · billing 33 ✓ · ocr 44 · catalog 50 · charts 33 · translate 69 · procurement 17 · crypto 12 · worker 11 (+1 skipped) — 13/13 test tasks, 17/17 typecheck tasks, web `tsc` 0 errors, web lint **0 errors** (6 pre-existing warnings), `supabase-sync --check` up to date (42 files), `next build` green.

New tests: `packages/api/src/__tests__/leakCheck.test.ts` (20 — analysis agorot-exact, PoW, links, sniffing, limits, gates, budget atomicity, 7-day purge + CHECK, **app role sees/writes 0 sandbox rows**), `apps/web/app/api/leak-check/__tests__/leakCheck.attack.test.ts` (13 — gate/kill-switch 404, cross-origin, forged/replayed PoW, honeypot, non-invoice bytes, 11 files, oversize, 411 chunked, per-IP, per-mailbox aliases, global cap, budget 503, prod fail-closed without proxy hops, forged lead link, one lead per result), cross-tenant `leakCheck.*` block (5 — forged link, foreign-email link, never re-pointed, isolation, flag off), `growth.test.ts` (13), `chainPricing.test.ts` (33), `migration-0055.test.ts`, `publicPaths.test.ts` (+1).

### Layer 2 — production build, he + en

`next build && next start` (`NODE_ENV=production`, RLS app role via `DATABASE_URL_APP`, Redis rate limits, `TRUSTED_PROXY_HOPS=1`, `LEAK_CHECK_ALLOW_SAMPLE=1`, password login as the seeded owner), Playwright script (Chromium): **28/28 pass** —
per locale: `/leak-check` 200, `<html lang dir>` he/rtl · en/ltr; upload → result: **he 4 invoices = ₪37.78** (creep 14.00 + 12.00, VAT 7.78, line 4.00), **en 5 invoices + price list = ₪57.78** (price list replaces creep; the 5th file = re-sent #5502 shown as a *possible duplicate* note, not counted); sample banner shown; tampered link shows no result; book-a-demo creates exactly one lead; `/pricing` 200 with the chain section; zero console errors; zero 5xx. Claim: signed-out → `/login?callbackUrl=…`, GET shows a confirm button only, POST attaches (owner, matching email). Mobile 390 px: no horizontal scroll (he/en).

Screenshots (`docs/client-ready/screenshots/`): `wave1-leak-check-{he,en}.png`, `wave1-leak-check-{he,en}-mobile.png`, `wave1-leak-check-result-{he,en}.png`, `wave1-leak-check-claim-he.png`, `wave1-pricing-{he,en}.png`.

### Independent refuter (subagent that did not write the code)

Held up: PoW replay, honeypot, sandbox invisible to `restomatch_app`, referral RLS (no foreign codes, no UPDATE/DELETE effect, `credited` insert rejected), `resolve_referral_code` (pinned `search_path`), claim filtering, no double counting, chain math integer-exact.
Found → fixed (each with a test):
1. **Spoofable XFF bypassed per-IP limits / drained the OCR budget** → production fails closed without `TRUSTED_PROXY_HOPS`; site-wide 40 submits/h cap.
2. **Two photos of one invoice reported 100 % of spend as "leak"** → duplicates are a note with the ₪ at risk, never counted.
3. **Chunked body skipped the pre-parse cap** → content-length required (411).
4. **False positives** (fee outside the line table; return line without its minus) → subtotal gap is a note; negative lines skipped.
5. **Claim via GET (CSRF) / anyone with the link could claim** → POST confirm + email must match.
6. **Referral self-dealing** (second restaurant of the same owner; A↔B swap) → rejected.
7. Copy "every shekel linked to the exact line" → "to the invoice (and line) it came from"; per-branch annual figure now rounded once.
Accepted, documented: the single-use PoW key goes through the fail-open rate-limit store (a Redis outage allows PoW replay — still bounded by the per-IP/global/budget limits); `creditReferralRedemption` does not yet require a paid subscription (it has no caller; wire it to the PSP "paid" webhook when billing goes live).
