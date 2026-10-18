# Verification — "is everything OK?" in one command

Two layers. **Layer 1** proves the code is sound (the same gate CI enforces).
**Layer 2** proves the *running product* works: a production build served by
`next start`, then the live deployment. Nothing here writes to production, sends
email, or needs a real key.

> עברית — בהמשך העמוד.

## Prerequisites (local)

- Node 22, pnpm 10.33 (`corepack enable`).
- Postgres 16 + pgvector on `localhost:5432` (user/password `postgres`), Redis on
  `localhost:6379` for the worker tests. `scripts/dev-setup.sh` sets both up.
- `scripts/verify.sh` refuses any non-local database. Layer 1 drops and re-creates its own
  database `restomatch_gate` each run (like CI's fresh container); layer 2 seeds `restomatch_verify`.

## Layer 1 — the full gate

```bash
REDIS_URL=redis://localhost:6379 scripts/verify.sh            # ≈ 8 min
```

| Step | Command it runs | Fails when |
|---|---|---|
| install | `pnpm install --frozen-lockfile` | lockfile out of date |
| migrate | `pnpm --filter @restomatch/db migrate` | a migration doesn't apply |
| provision-rls / check-rls | `… provision-rls`, `… check-rls` | a `restaurant_id` table without RLS |
| db-doctor | `… run doctor --strict` | unindexed FK, missing trigger, RLS drift (WARN fails too) |
| supabase-sync | `… run supabase-sync --check` | `supabase/migrations` stale vs `packages/db/drizzle` |
| typecheck | `pnpm turbo run typecheck --force --concurrency=1 --filter='!@restomatch/web'` | type error in a package |
| test | `pnpm turbo run test --force --concurrency=1 --filter='!@restomatch/worker'` | any test, incl. RLS attack suites + leak canary |
| worker-test | `pnpm --filter @restomatch/worker test` (needs `REDIS_URL`; otherwise SKIP) | worker/queue regression |
| web-lint | `pnpm --filter @restomatch/web lint` | any ESLint **error** |
| web-build | `pnpm --filter @restomatch/web build` | build or type error in the web app |
| web-tsc | `pnpm --filter @restomatch/web typecheck` | type error (runs after the build: needs `.next/types`) |
| audit | `pnpm audit --prod --audit-level=high` | a high/critical advisory in prod deps |

Output: a PASS / FAIL / SKIP table and `RESULT: PASS|FAIL`; exit code 1 on any
FAIL. Every step's full output is in `.verify/<step>.log` (gitignored).

**In CI** (`.github/workflows/ci.yml`) the same steps are split across the
blocking `test` (incl. `supabase-sync --check`), `worker-tests`, `web` and `audit`
jobs; layer 2 runs in the non-blocking `verify-layer2` job.

## Layer 2 — the running product

### 2a. Locally, against a production build

```bash
scripts/verify.sh layer2                    # build (if needed) + next start + smoke
VERIFY_E2E=1 scripts/verify.sh layer2       # … plus the Playwright suite (logged in, 5 roles × he/en)
scripts/verify.sh all                       # layer 1 then layer 2
```

What it does: creates and seeds a separate local DB `restomatch_verify` (demo
tenant, RLS app role) via `apps/web/e2e/prepare-db.ts`, starts `next start` with
`NODE_ENV=production` (boot guards on, placeholder email/storage keys) on port
3310, and runs `scripts/verify-prod.sh` against it. With `VERIFY_E2E=1` it also
runs the Playwright suite: login for every role, every dashboard page in he and en,
the receiving wizard, malformed-id 404s, zero console errors.

### 2b. Against the live deployment (read-only)

```bash
scripts/verify-prod.sh https://<your-app>.vercel.app
```

GET requests only, no login. Checks:

| Check | Pass condition |
|---|---|
| `/api/healthz` | 200 and `"status":"ok"` (prints the deployed commit) |
| landing he / en | 200, `<html lang="he" dir="rtl">` / `<html lang="en" dir="ltr">` |
| hero media | every `/media/*` file the landing references answers 200/206 with a video/image type |
| `/login` | 200 and renders "RestoMatch" |
| 12 public paths | `/ /pricing /about /privacy /terms /cookies /login /reset /showcase /robots.txt /sitemap.xml /icon.svg` → 2xx (a redirect means a public page went private) |
| unknown path | 404, or the anonymous redirect to `/login` — never a 5xx |

Exit code 1 on any failure. Run it after every production deploy, and before a
demo. CI runs it non-blocking against a local `next start` (job *verify layer 2*).

### Proven to fail

Each layer was shown to catch a real break, and to pass again once it was reverted:

| Mutation | Result |
|---|---|
| a failing vitest + a hand-edited `supabase/migrations` file | layer 1: `test` FAIL, `supabase-sync` FAIL, `RESULT: FAIL`, exit 1 |
| hero mp4 removed from `apps/web/public/media` | layer 2: `verify-prod` FAIL (`asset /media/hero-loop.mp4 404`), exit 1 |
| via a proxy in front of a good server: `/pricing` → 500 · hero mp4 → 404 · Hebrew landing served `dir="ltr"` · origin down | `verify-prod.sh`: the matching row FAILs, exit 1 |

### When something fails

| Symptom | Look at |
|---|---|
| layer 1 `test` FAIL | `.verify/test.log` — search `FAIL` |
| `supabase-sync` FAIL | run `pnpm db:supabase-sync` and commit `supabase/` |
| `prod-start` FAIL | `.verify/next-start.log` (a boot guard names the missing env var) |
| `verify-prod` healthz FAIL in production | Vercel → Deployments → the latest one → Runtime logs |
| landing `dir` / `lang` wrong | the `rm_locale` cookie / middleware (`apps/web/middleware.ts`) |

---

<div dir="rtl">

# אימות — "הכול תקין?" בפקודה אחת

שתי שכבות. **שכבה 1** מוכיחה שהקוד תקין (אותו שער שה-CI אוכף). **שכבה 2** מוכיחה
שהמוצר **הרץ** עובד: בנייה לפרודקשן שמוגשת ב-`next start`, ואז הפריסה החיה. שום דבר
כאן לא כותב לפרודקשן, לא שולח מייל ולא צריך מפתח אמיתי.

## דרישות מקומיות

- Node 22,‏ pnpm 10.33.
- Postgres 16 + pgvector על `localhost:5432`, ו-Redis על `localhost:6379` לבדיקות ה-worker
  (`scripts/dev-setup.sh` מקים את שניהם).
- `scripts/verify.sh` מסרב לעבוד מול מסד נתונים שאינו מקומי.

## שכבה 1 — השער המלא

```bash
REDIS_URL=redis://localhost:6379 scripts/verify.sh
```

מריץ: התקנה עם lockfile קפוא, מיגרציות, הקמת RLS ובדיקת שלמות RLS, ‏`db:doctor --strict`,
בדיקת סנכרון `supabase/`, בדיקת טיפוסים, כל הבדיקות (כולל מבחני התקיפה של RLS
וקנרית הדליפה), בדיקות ה-worker, ‏ESLint ללא שגיאות, בניית האתר, ‏`tsc` לאתר ו-audit.
בסוף: טבלת PASS / FAIL / SKIP ו-`RESULT`; קוד יציאה 1 אם משהו נכשל. הלוג המלא של כל
שלב נמצא ב-`.verify/<step>.log`.

## שכבה 2 — המוצר הרץ

**מקומית, מול בנייה לפרודקשן:**

```bash
scripts/verify.sh layer2                  # בנייה + next start + בדיקת עשן
VERIFY_E2E=1 scripts/verify.sh layer2     # + סוויטת Playwright (התחברות, 5 תפקידים × עברית/אנגלית)
```

**מול האתר החי (קריאה בלבד):**

```bash
scripts/verify-prod.sh https://<האתר-שלך>
```

בודק: ‏`/api/healthz`, דף הנחיתה בעברית (`dir="rtl"`) ובאנגלית (`dir="ltr"`), קובצי
הווידאו והתמונה של ה-hero, ‏`/login`, ‏12 דפים ציבוריים בלי שגיאות, ונתיב לא קיים ⇐ 404
(או הפניה ל-`/login`). קוד יציאה 1 בכל כישלון. להריץ אחרי כל פריסה ולפני כל דמו.

כל בדיקה הוכחה כתופסת תקלה אמיתית: ‏`/pricing` שמחזיר 500, וידאו שחסר, דף עברי עם
`dir="ltr"`, ושרת שלא עונה — כולם הניבו FAIL וקוד יציאה 1.

</div>
