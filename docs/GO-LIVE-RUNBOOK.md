# Go-Live Runbook — RestoMatch

> נכתב 2026-06-26 לאחר אימות חי (read-only) מול הספקים: Supabase, Vercel, Fly, build.
> זהו ה-runbook הקנוני לעלייה לאוויר. מחליף את חלקי המיגרציות שב-
> [`DEPLOY_CUTOVER.md`](./DEPLOY_CUTOVER.md) ו-[`DEPLOY_supplier_catalog_cadence.md`](./DEPLOY_supplier_catalog_cadence.md)
> (שניהם נכתבו כשפרוד היה ב-0008 — כבר לא רלוונטי, ראו למטה).
> **secrets לעולם לא בצ'אט** — הגדרה ב-Vercel env / `fly secrets set` בלבד.

---

## מצב מאומת (2026-06-26)

| רכיב | סטטוס | פרטים שאומתו |
|---|---|---|
| **Build / Typecheck** | ✅ עובר | `pnpm typecheck` 15/15, `pnpm build` → `next build` 30/30 עמודים, working tree נקי |
| **Supabase** (`cringgshiafwsszyqufo`, ap-southeast-2) | ✅ חי + מהוגר | סכמה **עד 0018** (`invitations`/`supplier_catalog_items`/`catalog_imports` קיימות), 38 טבלאות, **RLS על כולן**, 0 advisors ברמת ERROR |
| **תפקיד `restomatch_app`** | ✅ תקין | `rolbypassrls = false`, `rolcanlogin = true` → RLS ייאכף כש-`DATABASE_URL_APP` מצביע עליו |
| **Vercel** (`project-6bs41`) | ✅ מחובר + READY | הדיפלוי האחרון לפרודקשן READY; 9 env vars מוגדרים (Production scope) |
| **קוד ה-worker** | ✅ artifacts מוכנים | `apps/worker/{fly.toml,Dockerfile,src/health.ts}` + `.dockerignore` בשורש |
| **פריסת ה-worker** | ❌ **לא הועלה** | אין אפליקציית Fly פעילה — זה הפער הגדול |
| **Redis (Upstash)** | ❌ לא הוקם | `REDIS_URL` חסר |
| **Resend (אימייל)** | ❌ לא מוגדר | `RESEND_API_KEY` + `EMAIL_FROM` (דומיין מאומת) חסרים |

> ⚠️ **מיגרציות 0009–0018 כבר רצו בפרוד.** המסמכים `DEPLOY_CUTOVER.md` /
> `DEPLOY_supplier_catalog_cadence.md` מזהירים ש"פרוד תקוע ב-0008" — **זה מיושן ולא נכון.**
> **אל תריץ מחדש את המיגרציות ולא את החלת ה-RLS** — drizzle הוא forward-only והרצה חוזרת
> עלולה להיכשל / לגרום drift.

---

## 9 משתני הסביבה שכבר ב-Vercel (Production)

`DATABASE_URL` · `DATABASE_URL_APP` · `NEXT_PUBLIC_SUPABASE_URL` ·
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`AUTH_SECRET` · `AUTH_URL` · `APP_URL` · `ANTHROPIC_API_KEY`

**3 חסרים ל-web** (ה-boot guard `assertWebEnv` יפיל את ה-deploy של הענף עד שיוגדרו):
`RESEND_API_KEY` · `EMAIL_FROM` · `REDIS_URL`

---

## הצעדים שנותרו לעלייה לאוויר

### 1. הקם Redis (Upstash) → `REDIS_URL`
חובה גם ל-web (rate-limiter ל-magic-link) וגם ל-worker (תורי BullMQ: OCR / match / cron / outbox).
→ Upstash → Create Database (אזור eu, persistence מופעל) → העתק את ה-`redis://...` connection string.

### 2. הקם Resend → `RESEND_API_KEY` + `EMAIL_FROM`
זה מה ששובר כרגע את ההתחברות (הקוד הישן זורק על magic-link כש-`EMAIL_FROM` מוגדר בלי Resend עובד).
1. חשבון Resend → API key.
2. **אמת דומיין** (SPF/DKIM) — אחרת המייל 403 / נכנס לספאם.
3. `EMAIL_FROM` בפורמט: `RestoMatch <auth@restomatch.co.il>`.

### 3. הוסף את 3 המשתנים ל-Vercel (Production)
```bash
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM      production   # RestoMatch <auth@restomatch.co.il>
vercel env add REDIS_URL       production
```
(אופציונלי: `PLATFORM_ADMIN_EMAILS` כדי לאתחל את מנהל הפלטפורמה הראשון.)

### 4. פרוס את ה-web (Vercel)
```bash
vercel deploy --prod        # מהשורש; הפרויקט כבר מקושר דרך .vercel/project.json
# או: merge הענף feat/supplier-catalog-cadence → main (auto-deploy)
```
> הסדר חשוב: בלי צעד 3, ה-boot guard מפיל את ה-deploy.

### 5. פרוס את ה-worker (Fly.io) — מעולם לא הועלה
בלי ה-worker: העלאת חשבונית "מצליחה" אבל **OCR / matching / חישוב הדליפה ₪ / תזכורות cadence לא רצים** (חור שחור שקט). Build context = שורש הריפו.
```bash
# פעם ראשונה
fly launch --no-deploy --copy-config --name restomatch-worker --config apps/worker/fly.toml
fly secrets set -a restomatch-worker \
  DATABASE_URL=... REDIS_URL=... ANTHROPIC_API_KEY=... \
  RESEND_API_KEY=... EMAIL_FROM=... APP_URL=...
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
# אימות
fly checks list -a restomatch-worker
fly logs -a restomatch-worker | grep -E "started .* workers|health server|cron"
```

### 6. בדיקת עשן (smoke)
```bash
curl https://<web>/api/healthz                                       # {"status":"ok"}
fly ssh console -a restomatch-worker -C "curl -s localhost:8080/health/ready"
```
- [ ] **Login:** `/login` → אימייל → התקבל מייל אמיתי (Resend) → התחברת לדשבורד.
- [ ] **Team:** `/dashboard/team` → הזמן `receiver` → מייל הזמנה → הצטרפות אוטומטית (nav: סקירה + קליטת סחורה).
- [ ] **End-to-end:** העלה חשבונית → job נכנס ל-Redis → OCR → match → **מספר הדליפה ₪ מופיע**.
- [ ] **Cron:** `fly logs -a restomatch-worker | grep cron` → daily-expectations(06:00), baselines(02:00), outbox-dispatch(60s).

---

## אופציונלי (לא חוסם עלייה לאוויר)
- **דומיין מותאם** — כרגע רק `*.vercel.app`.
- **משתני Preview scope** — כיום ה-env vars רק ב-Production; דיפלויי preview/branch ייפלו בלי DB/Auth.
- **`DATABASE_URL_APP` ב-Vercel** — הערך מוצפן; ודא שהוא מצביע על `restomatch_app` (התפקיד עצמו אומת תקין: `rolbypassrls=false`).
- **OCR tie-break** — `GOOGLE_DOCUMENT_AI_*` (סטאב כרגע; אופציונלי).
- **WhatsApp** — `WHATSAPP_*` (נופל ל-email בלי זה).
- **MarketMan** — `MARKETMAN_*` (טרם מחובר לקוד).
- **Observability** — `SENTRY_DSN` / `POSTHOG_API_KEY`.
- **שער אבטחה לפני גביית כסף** — כיסוי ה-RLS attack manifest ירוק (`team.*`/`mapping.*`) + ודא ש-`DATABASE_URL_APP` בפרוד מצביע על `restomatch_app`.

---

## ניקוי drift לפני tenant משלם (לא חוסם פיילוט)
- `supplier_contacts` — טבלה בפרוד שלא קיימת בשום migration/schema (advisor: `rls_enabled_no_policy`). החלט: למחוק או לקפל ל-schema+migration.
- policies של `invoice_scans` showcase (`showcase_ins`/`showcase_sel`, anon + NULL restaurant) — לא ב-version control; הסר/הסדר.
- חוב migrations: `drizzle-kit generate` שבור (snapshots עוצרים ב-0013); כל מיגרציה עתידית נכתבת ביד כ-`NNNN_*.sql`.
