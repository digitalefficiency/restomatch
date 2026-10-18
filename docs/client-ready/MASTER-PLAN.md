# RestoMatch — Master plan (owner: "I want everything", 2026-10-18)

> **תקציר לבעלים (עברית)**
> - **גל 0 — לדמו של מחר (עולה ל-`main` הערב, באישורך):** תיקוני הסקירה הסופית, QA מלא לכל אזור, סניפים + דאשבורד רשתי + פערי מחיר בין סניפים, תצוגות מתקדמות בדאשבורד, דף נחיתה חדש, סרטון פרומו, ומעבר הפרודקשן ל-Supabase החדש.
> - **גל 1 — כל רעיונות השדרוג (נבנים במקביל עכשיו):** מחירון חוזי, התראות מחיר, מעקב "₪ חוזר", דוח חודשי, קליטה מוואטסאפ/מייל, מצב מקבל בטלפון (PWA), שפות נוספות למקבלים, עוזר AI, בדיקת דליפה חינם, תמחור רשתות, עלות מנה, אינטגרציות, וורקר בענן + ניטור.
>   כל פיצ'ר של גל 1 נמצא **מאחורי דגל לכל מסעדה** — דלוק במסעדת הדמו, כבוי אצל כל השאר עד שתחליט. כך הכל יכול להגיע לפרודקשן בלי לסכן את הדמו.
> - **כל שינוי עובר שתי שכבות בדיקה** (docs/VERIFICATION.md): (1) כל הבדיקות האוטומטיות, (2) בדיקה תפקודית על build של פרודקשן בעברית ובאנגלית לכל תפקיד + בודק עצמאי שמנסה להפריך. אחרי כל העלאה לפרודקשן — בדיקה של האתר החי.

## 1. Rules for every session (binding)

1. Read `AGENTS.md`, `STATE.md`, `docs/client-ready/SESSION-BRIEF.md` (env setup, i18n, hard rules) and this file.
2. **Two layers of verification after every update** (owner rule) — `docs/VERIFICATION.md` once it lands;
   until then: layer 1 = full gate (`pnpm install --frozen-lockfile`, `turbo run test --concurrency=1`,
   `turbo run typecheck`, web `tsc --noEmit`, web lint 0 errors, `supabase-sync --check`, web `pnpm build`);
   layer 2 = (a) production build (`next build && next start`, `NODE_ENV=production`, RLS app role, password
   login as seeded users) clicked through with Playwright in **he and en** for every role that can reach the
   change — HTTP < 400, right `<html lang/dir>`, zero console errors, zero server 5xx, key ₪ numbers right;
   (b) an **independent subagent refuter** that did not write the code tries to prove it broken. Fix → re-run both.
   Every report has a **"Verification (2 layers)"** section with exact commands and results.
3. **Wave-1 features are behind a per-restaurant flag**: `featureEnabled(restaurant.settings, '<key>')` from
   `@restomatch/api` (`packages/api/src/lib/features.ts`). Off by default; the seeded demo tenant has
   `settings.features.all = true`; `FEATURES_OFF=all|k1,k2` is the production kill-switch. A disabled feature
   is invisible (nav hidden, route 404/redirect, procedures FORBIDDEN with appCode `FEATURE_DISABLED`).
4. **Security**: every new tRPC procedure runs under RLS (`memberProcedure`/role procedures +
   `withRestaurant`), gets a COVERAGE entry and an isolation assertion in
   `packages/api/src/__tests__/cross-tenant.attack.test.ts`. Every new **public** route (webhooks, lead magnets)
   has signature/secret verification, rate limiting (`apps/web/lib/rateLimit.ts` store), size limits, no tenant id
   from the client, and its own attack test.
5. **Money**: integer agorot at the boundary, ₪ only via `formatIls()`, the leak-canary never moves.
6. **External services** (WhatsApp, email inbox, accounting, MarketMan/Zester, POS, Claude, hosting): build
   behind a provider interface with a deterministic offline/stub provider and mocked tests. **No real accounts,
   no credentials, no spending, no production writes** — activation steps go to the owner in your report.
7. **Migrations**: hand-written SQL + journal entry + shape test, then `pnpm db:supabase-sync` to APPEND the
   supabase file. Use ONLY your assigned numbers (§4). Never edit a released file
   (`supabase/released-migrations.json`). Additive only. List immutable files touched in your report.
8. Branch: your assigned branch only; draft PR into `claude/client-ready`; push every 45 min; when done send
   ONE message (head SHA + both layers' results) to the orchestrator `session_015veCjPjLCiZbqnYFJpdzvR` via
   the claude-code-remote `send_message` tool.
9. Hebrew-first + full English parity (typed i18n namespaces, RTL logical classes, `lib/i18n/format`). One
   namespace per owner — create your own.

## 2. Wave 0 — demo-critical (tonight)

| Track | Session | Branch | Scope |
|---|---|---|---|
| DB fixes + QA | S1 `session_015nA9kKBJMffZKx375gfz1t` | claude/client-ready-db | SB-3 walk-ins policies (with S2), F2 env doc, F8 plans migration, DEMO_PASSWORD note, full DB QA |
| Receiving fixes + QA | S2 `session_01CSG2TZD9WPG5xEGxqo16WE` | claude/client-ready-english-receiving | EN-2 downscale, EN-3 OCR nulls, EN-4 polling, EN-5 false alarms, WIZ-ERR, BUDGET, EN-8, SB-3 showcase server upload, QA |
| Dashboard views + numbers | S3 `session_01NhHsvBccukD5pNji1YNNF7` | (its pinned branch) | period/compare/group-by/filters/chart toggles/density/TV/CSV/saved views; NUM-6/7/10 |
| Auth/security QA | S4 `session_01QDk6URRxzNXtob3cUqAHeS` | claude/client-ready-secreview | F4 AUTH_SECRET guard, role × page matrix QA |
| Ops fixes + QA | S5 `session_017ijqPCABPNRkVXRY17w1zZ` | claude/client-ready-ops-ui | EXP-DUP-1, ops QA |
| Landing v2 + showcase numbers | S6 `session_01QwcZZoVmXFuHZEAVER4J7s` | claude/client-ready-landing (#37) | landing v2, NUM-2..5 |
| System QA | S7 `session_01P2xrNbtVALHiYXkEVJXxNg` | claude/client-ready-platform | EN-7 queue fail-fast, whole-system QA, adopt verify.sh into CI |
| Branches + chain dashboard | S8 `session_01EUH5zt6usw9BZA9mk7PmKW` | claude/client-ready-chain | switcher, branch mgmt, chain dashboard, price disparity, demo chain seed |
| Promo video | S10 `session_01AJ62ghtXmK8tvXufzwDoX7` | claude/client-ready-promo | 60 s he/en (+vertical), hero loop for the landing |
| Two-layer harness | orchestrator | claude/client-ready | `scripts/verify.sh`, `scripts/verify-prod.sh`, `docs/VERIFICATION.md` |

**Release 0** (orchestrator): merge each track only after its 2 layers + orchestrator cross-QA → full
`verify.sh all` on the merged head → owner go → `main` → Supabase applies migrations → `verify-prod.sh` +
Vercel runtime errors = 0 new → demo script.

## 3. Wave 1 — every upgrade idea (parallel now, flag-gated)

| # | Feature (flag key) | Session | Branch | Migrations |
|---|---|---|---|---|
| 1, 4, 11 | Supplier **contract price lists** checked on every invoice (`contracts`); **price-trend alerts** + per-supplier thresholds (`priceAlerts`) | S11 | claude/wave1-contracts | 0046–0047 |
| 2, 3 | **₪-back tracker** claim → credit note → money returned (`recovery`); **monthly "one number" report** email/WhatsApp/PDF (`monthlyReport`) | S12 | claude/wave1-recovery | 0048–0049 |
| 6, 7 | **WhatsApp + email ingestion** of invoices (`ingestWhatsapp`, `ingestEmail`); **receiver PWA** with offline photo queue (`receiverPwa`) | S13 | claude/wave1-ingest | 0050–0051 |
| 8, 12 | **More receiver languages** ar/ru/th/ti (`receiverLanguages`); **AI assistant** "why did the leak change?" (`aiAssistant`) | S14 | claude/wave1-lang-ai | 0052–0053 |
| 13, 14 | **Free leak check** lead magnet (`leakCheck`); **chain pricing** per branch, annual billing, referral | S15 | claude/wave1-growth | 0054–0055 |
| 5 | **Food cost per dish** (recipes, dish margin, price-change impact) (`recipes`) | S17 | claude/wave1-recipes | 0056–0057 |
| 9 | **Integrations**: accounting exports (Hashavshevet / Priority / Rivhit file formats), MarketMan/Zester adapters, POS interface (`integrations`) | S5 after its QA | claude/client-ready-ops-ui | 0058 |
| 15, 16 | **Worker in the cloud** (deploy config for the existing Docker image), monitoring/uptime/daily health, backups/PITR + staging runbook | S7 after its QA | claude/client-ready-platform | — |

**Integration**: wave-1 branches merge into `claude/wave1` (orchestrator / integrator session) after their
2 layers + cross-QA (a different session QA's each feature: security-sensitive ones by S4). Release to `main`
flag-off for real tenants, flag-on for the demo tenant.

## 4. Migration numbers (`when` must increase; release order = `when` order)

S1 0041–0042 (1781960000000, 1781970000000) · S8 0043–0044 (1781980000000, 1781990000000) ·
S3 0045 (1782000000000) · S11 0046–0047 (1782010000000, 1782020000000) · S12 0048–0049 (1782030000000,
1782040000000) · S13 0050–0051 (1782050000000, 1782060000000) · S14 0052–0053 (1782070000000,
1782080000000) · S15 0054–0055 (1782090000000, 1782100000000) · S17 0056–0057 (1782110000000,
1782120000000) · S5 0058 (1782130000000) · S2/S4/S7 if needed 0059–0061 (1782140000000…).
The Supabase GitHub integration refuses a version older than the last applied one: the orchestrator renumbers
any unreleased migration whose `when` is below the last released one before it reaches `main`.

## 5. Owner actions (only the owner can do these)

1. Vercel Production env (§5 of `docs/SUPABASE-GITHUB-DEPLOY.md`): `AUTH_ENC_KEY`, new-project DB URLs
   (`DATABASE_URL_APP` user `restomatch_app.<ref>`), Supabase URL/keys, `AUTH_URL`=`APP_URL`=demo origin,
   `REDIS_URL` (`rediss://`), no old ref anywhere → **Redeploy**.
2. Supabase SQL editor: `alter role restomatch_app with login password '…'`; Data API stays **ON**; anon/authenticated grants = 0.
3. Demo data on the new project (§7) with a private `DEMO_PASSWORD`; then the chain demo script (S8).
4. Worker on the Mac → `main`, `worker.env` → new project, restart, `caffeinate`.
5. Test the exact demo invoice file on production tonight.
6. Decisions: trial policy; when to switch wave-1 flags on for real tenants; music for the promo video.

## 6. Demo-day script (draft — finalized after Release 0)

Landing (he) → 60 s promo → log in as owner → leak hero (₪ number) → leaks heatmap → approvals → claim letter →
switch to chain dashboard (3 branches, price disparity) → advanced views (compare to last month, TV mode) →
receiver on a phone in English (Hebrew invoice → English lines) → ₪-back tracker / monthly report (flagged
features, demo tenant) → pricing.
