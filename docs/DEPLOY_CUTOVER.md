# Pilot Cutover Runbook — RestoMatch

> נכתב לאחר האודיט מ-2026-06-21. זהו הנתיב הקריטי (credentialed) להעלאת מסעדת פיילוט.
> **כל הצעדים כאן דורשים אישור אנושי + credentials** — סוכן לא מריץ אותם אוטומטית
> (ראה `AGENTS.md` §"Autonomy is PR-only"). עבודת הקוד שלא דורשת credentials מתועדת
> בנפרד ב-`STATE.md` / רשימת המשימות.

---

> ## 🟢 עדכון 2026-06-26 — קאטאובר המיגרציות כבר בוצע (אומת חי)
>
> אימות ישיר מול ה-Supabase החי (פרויקט `cringgshiafwsszyqufo`, read-only):
> - **הסכמה כבר עד מיגרציה 0018** — `invitations`, `supplier_catalog_items`,
>   `catalog_imports` כולן קיימות; 38 טבלאות, **RLS מופעל על כולן**, 0 advisors ברמת ERROR.
> - תפקיד `restomatch_app` קיים עם **`rolbypassrls = false`** (RLS ייאכף ברגע
>   ש-`DATABASE_URL_APP` מצביע עליו).
>
> **לכן §0–§3 כאן (גיבוי-לפני-DDL, הרצת מיגרציות 0009–0018, החלת RLS) — בוצעו כבר.
> אל תריץ אותן שוב** — drizzle הוא forward-only והרצה חוזרת עלולה להיכשל / לגרום drift.
> מה שבאמת נותר לעלייה לאוויר מרוכז ב-[`GO-LIVE-RUNBOOK.md`](./GO-LIVE-RUNBOOK.md):
> Redis (Upstash), Resend (key + דומיין מאומת), הוספת `RESEND_API_KEY`/`EMAIL_FROM`/`REDIS_URL`
> ל-Vercel, deploy ל-web, ופריסת ה-worker ל-Fly (טרם הועלה). §4–§8 כאן (env, worker, web,
> smoke, שער אבטחה) עדיין תקפים.

---

## ⚠️ הממצא שמכתיב את הסדר (מיושן — נכון ל-2026-06-21, ראה עדכון למעלה)

האודיט אימת מול ה-DB החי: **פרודקשן תקוע ב-migration 0008. מיגרציות 0009–0018 מעולם
לא הורצו.** הטבלאות `catalog_imports`, `supplier_catalog_items`, `invitations` לא קיימות
בפרוד, והעמודות `products.supplier_id`, `suppliers.order_schedule/vat_rate`,
`notifications_outbox.dedupe_key` חסרות. **כל הקוד של הגל האחרון יזרוק 500 בפרוד** עד
שמריצים את המיגרציות. הבשורה הטובה: פרוד כמעט ריק (מסעדה אחת, 0 ספקים) → forward-migrate
הוא low-risk.

---

## סדר הצעדים (אל תדלג / אל תשנה סדר)

### 0 — Pre-flight

```bash
# אמת את מצב המיגרציות בפרוד (אמור להחזיר את 0008_search_trgm)
psql "$DATABASE_URL_DIRECT" -c "select * from drizzle.__drizzle_migrations order by id desc limit 1;"
# גיבוי לוגי לפני שינוי סכמה (פרוד קטן — שניות)
pg_dump "$DATABASE_URL_DIRECT" --schema=public --no-owner > backup_pre_cutover.sql
```

`DATABASE_URL_DIRECT` = החיבור הישיר (פורט **5432**, לא ה-pooled 6543), על ה-**owner**.
מיגרציות + RLS רצים תמיד על ה-owner/direct, לעולם לא על ה-app role או ה-pooler.

### 1 — Forward-migrate 0009→0018

> **חשוב — ה-drizzle migrator עלול להיתקע על האצווה הזו.** מקומית, ה-postgres-js
> migrator (single-transaction) לא השלים על האצווה 0009–0018, בעוד שהחלת הקבצים
> **אחד-אחד דרך psql הצליחה נקי** (כל קובץ ב-autocommit נפרד, כך ש-`ALTER TYPE ADD
> VALUE` ב-0012/0015 רץ ב-tx משלו ולא נופל על מגבלת "enum value used in same tx").
> זו ככל הנראה בעיית ה-single-tx שהאודיט סימן (ואולי גם איטיות ה-runner המקומי).
> **המלצה: בדוק קודם על Supabase branch; אם ה-migrator נתקע — fallback ל-file-by-file.**

**נתיב מומלץ (file-by-file, דטרמיניסטי):**

```bash
DB="$DATABASE_URL_DIRECT"
for f in packages/db/drizzle/0009_*.sql packages/db/drizzle/001*.sql; do
  echo ">>> $f"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f" || { echo "FAILED at $f"; break; }
done
# אמת
psql "$DB" -c "select to_regclass('public.invitations'), to_regclass('public.supplier_catalog_items'), to_regclass('public.catalog_imports');"
```

> **bookkeeping:** החלה ידנית לא רושמת ב-`drizzle.__drizzle_migrations`. כדי שמיגרציות
> עתידיות יֵדעו את המצב, או (א) הרץ פעם אחת את ה-migrator אחרי ה-cutover על DB שכבר
> במצב הנכון (no-op שירשום), או (ב) הוסף ידנית את ה-hash+created_at של 0009–0018
> (כפי ש-drizzle מחשב). מתועד כ-follow-up; לא חוסם פיילוט.

### 2 — RLS: החלה מחדש + grants לטבלאות החדשות

שלוש הטבלאות החדשות (`catalog_imports`, `supplier_catalog_items`, `invitations`) **לא
מקבלות policy או grant** אוטומטית (rls/0002 הוחל בזמן שפרוד היה ב-0008). חובה:

```bash
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f packages/db/drizzle/rls/0001_invoice_scans_rls.sql
psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f packages/db/drizzle/rls/0002_core_tenant_rls.sql
# מחדש את ה-restomatch_app role + grants (ensureRlsAppRole) — דרך הסקריפט/ה-tRPC bootstrap
DATABASE_URL="$DATABASE_URL_DIRECT" pnpm --filter @restomatch/db exec tsx -e \
  "import {createDb,ensureRlsAppRole} from './src/index'; const db=createDb(process.env.DATABASE_URL); await ensureRlsAppRole(db, process.env.RESTOMATCH_APP_PASSWORD)"
```

> `0002` מסתיים ב-**completeness invariant** שנכשל בקול אם נשארה טבלת `restaurant_id`
> בלי RLS — זו רשת הביטחון. אל תעקוף אותה.

**ניקוי drift לא-מתועד (לפני שמסעדה משלמת נכנסת):**
- `supplier_contacts` — טבלה בפרוד שלא קיימת בשום migration/schema, בלי `restaurant_id`,
  RLS-enabled-no-policy, עם DML מלא ל-`restomatch_app`, ונכתבת ע"י endpoint ציבורי
  (`/api/showcase/ocr`). **החלט: למחוק או לקפל ל-schema+migration.** לפיילוט — מחיקה
  אם לא בשימוש פרודקשן.
- policies של `invoice_scans` showcase (`showcase_ins`/`showcase_sel`, anon + NULL
  restaurant) — לא ב-version control. הסר/הסדר לפני tenant משלם.

### 3 — אמת ש-RLS באמת חי (החוסם הכי מסוכן)

ה-web נופל בשקט ל-owner connection (עוקף RLS) אם `DATABASE_URL_APP` לא מוגדר. חובה:

```bash
# (א) DATABASE_URL_APP חייב להצביע על restomatch_app (לא owner), עם rolbypassrls=false:
psql "$DATABASE_URL_APP" -c "select current_user, rolbypassrls from pg_roles where rolname=current_user;"
#   → current_user = restomatch_app, rolbypassrls = f   (אם t או owner — RLS אינרטי!)
```

ה-boot guard בקוד (assertion ש-`rolbypassrls=false`) נכלל בעבודת `packages/env` (ראה
משימת "packages/env fail-fast"). ודא שהוא ירוק ב-startup לפני שמפנים תעבורה.

### 4 — Env provisioning (Vercel web + Fly worker)

| משתנה | איפה | פותח |
|---|---|---|
| `DATABASE_URL` (pooled 6543) | web + worker | queries |
| `DATABASE_URL_DIRECT` (5432) | migrations/RLS בלבד | cutover |
| `DATABASE_URL_APP` (restomatch_app, pooled) | **web** | RLS חי בפרוד |
| `SUPABASE_SERVICE_ROLE_KEY` | web | signed URLs ל-`/scans` |
| `RESEND_API_KEY` + `EMAIL_FROM` (דומיין מאומת) | web + worker | login + הזמנות + התראות |
| `AUTH_URL` / `AUTH_SECRET` / `APP_URL` | web | magic-link auth |
| `REDIS_URL` (Upstash) | web + worker | תורי OCR/match/cron |
| `ANTHROPIC_API_KEY` | worker | OCR אמיתי |
| `GOOGLE_DOCUMENT_AI_*` + `GOOGLE_APPLICATION_CREDENTIALS` | worker | OCR tie-break |
| `SENTRY_DSN` (+ `POSTHOG_API_KEY`) | web + worker | observability |

> **אל תדביק secrets בצ'אט.** הגדר ב-Vercel env / `fly secrets set` ותגיד "הוגדר".

### 5 — פריסת ה-worker (Fly.io)

הארטיפקטים מוכנים: `apps/worker/{fly.toml,Dockerfile}` + `apps/worker/src/health.ts`
(שרת `/health` ל-liveness probe) + `.dockerignore` בשורש. **Build context = שורש הריפו.**

```bash
# פעם ראשונה
fly launch --no-deploy --copy-config --name restomatch-worker --config apps/worker/fly.toml
fly secrets set -a restomatch-worker DATABASE_URL=... REDIS_URL=... ANTHROPIC_API_KEY=... \
                RESEND_API_KEY=... EMAIL_FROM=... APP_URL=...
# deploy (מהשורש, context = .)
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
# אמת
fly checks list -a restomatch-worker        # health = passing
fly logs -a restomatch-worker | grep -E "started .* workers|health server|cron"
```

בלי ה-worker: העלאות חשבונית מצליחות אבל OCR/matching/leak/cadence **לא רצים** (חור שחור).

### 6 — פריסת web (Vercel)

ראה `docs/DEPLOY.md`. ודא שכל ה-env מ-§4 מוגדרים ב-Vercel, ואז deploy ה-branch.

### 7 — אימות post-cutover (smoke)

```bash
curl https://<web>/api/healthz                       # {"status":"ok"}
fly ssh console -a restomatch-worker -C "curl -s localhost:8080/health/ready"   # redis up
```
- [ ] Login: בקש magic-link → התקבל מייל (Resend) → התחברת.
- [ ] צור מסעדה (onboarding) → לא נתקעת ב-/team/settings (תיקון stale-JWT).
- [ ] העלה חשבונית → job נכנס ל-Redis → OCR → match → מספר ה-leak מופיע.
- [ ] RLS probe: משתמש tenant A לא רואה נתוני B (ראה `rls.attack.test.ts`).

### 8 — שער אבטחה (חובה לפני שגובים כסף)

- [ ] **ה-attack COVERAGE manifest ירוק** — `team.*`/`mapping.*` כוסו (משימה נפרדת,
      קוד בלבד). בלי זה, ה-gate הבלתי-עקיף לא מאשר כלום על 10 procedures שכותבים tenant data.
- [ ] `DATABASE_URL_APP` מאומת (§3) — אחרת גבול ה-tenant ב-DB לא קיים.

---

## נספח — חוב migrations (post-pilot, לא חוסם)

- **`drizzle-kit generate` שבור:** שרשרת ה-snapshots ב-`packages/db/drizzle/meta/`
  עוצרת ב-0013 (journal עד 0018; 0014–0018 נכתבו ביד). generate ייצר migration מזויף.
  **כל מיגרציה עתידית נכתבת ביד** כ-`NNNN_*.sql` הבא. תיקון: לשחזר את snapshots
  0014–0018 (introspect טרי) — דחוי לאחרי הפיילוט.
- **כלל isolate-enum:** מיגרציה עם `ALTER TYPE ... ADD VALUE` חייבת להיות **לבדה**
  בקובץ/אצווה (לא בתוך batch שמשתמש בערך החדש באותו tx) — אחרת ה-migrator נופל.
