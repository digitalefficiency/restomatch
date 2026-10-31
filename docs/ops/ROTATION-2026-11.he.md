# החלפת סודות שנחשפו — יום א׳ 1.11.2026, ‏07:30–10:00

<div dir="rtl">

**למי:** רום (הבעלים). אתה מבצע כל צעד בעצמך. המדריך הזה רק מסביר; אף סוכן לא מבצע אותו.

**למה:** כמה סודות של הפרודקשן הופיעו בצ'אטים ובצילומי מסך, ולא הוחלפו מאז:

| משתנה (Vercel → Production) | נחשף ב- |
|---|---|
| `DATABASE_URL` (סיסמת ה-DB של `postgres`) | 25.10 |
| `CRON_SECRET` | 24.10 |
| `SUPABASE_SECRET_KEY` + `SUPABASE_SERVICE_ROLE_KEY` | 18.10 |
| `DEMO_PASSWORD` | 18.10 |
| `RESEND_API_KEY` + `EMAIL_FROM` | 26.06 (לפני שהדומיין `digitalefficiency.co.il` אומת ב-11.07). **לכן המיילים בפרודקשן נכשלים היום.** |

גם `DATABASE_URL_APP` שבור: הסיסמה בתוכו לא מקודדת, והוא חשוף גם ל-Preview.

**לא מחליפים את `AUTH_ENC_KEY`.** הוא מצפין את סודות האימות הדו-שלבי (2FA). החלפה שלו תנעל בחוץ כל מי שהפעיל 2FA.

**כללי ברזל לכל המדריך:**
- סיסמה או מפתח חדש נשמר **קודם** במנהל הסיסמאות, ורק אחר כך מוזן במקום אחר.
- לא מדביקים שום סיסמה, מפתח או `DATABASE_URL` בצ'אט, בהודעה, ב-GitHub או בקובץ.
- כשמקלידים סיסמה בטרמינל היא לא מוצגת על המסך. זה תקין.
- בסוף כל צעד יש "מה צריך לראות". אם רואים משהו אחר, עוצרים ופועלים לפי "אם לא".
- רושמים כל צעד שבוצע ב-`docs/ops/OPS-LOG.md` (שעה, פעולה, תוצאה).

> ⚠️ **אחרי ההחלפה: אסור לעשות Instant Rollback לבנייה שנוצרה לפני 1.11.** בנייה ישנה ב-Vercel רצה עם המשתנים מהרגע שבו נבנתה, כלומר עם הסיסמאות הישנות. היא לא תצליח להתחבר למסד, ותחזיר לשימוש סודות שנחשפו. Rollback מותר רק לבנייה שנוצרה **אחרי** ההחלפה (ראו `PROMOTE-ROLLBACK.he.md`).

---

## 0. הכנה — מוצ״ש 31.10, ‏21:30 (כ-15 דקות)

**במק, בטרמינל:**

```bash
node -v
pnpm -v
psql --version
pg_dump --version
cd ~/restomatch && git checkout main && git pull && pnpm install --frozen-lockfile
```

**מה צריך לראות:**
- `node -v` → `v22.x`.
- `pnpm -v` → `10.33.0`.
- `psql` ו-`pg_dump` → **17** ומעלה (גרסת השרת ב-Supabase היא 17).
- `git pull` ו-`pnpm install` מסתיימים בלי שגיאה.

**אם לא:**
- Node אחר: `nvm install 22 && nvm use 22`.
- pnpm אחר: `corepack enable && corepack prepare pnpm@10.33.0 --activate`.
- `psql`/`pg_dump` חסרים או ישנים: `brew install libpq && brew link --force libpq`.

**בדפדפן**, ודא שאתה מחובר ושיש לך את מכשיר ה-2FA של כל אחד מאלה:
- Supabase (הפרויקט `rutbnmvkwirqtixvuhdq`)
- Vercel (הפרויקט `project-6bs41`)
- Resend (הצוות שמחזיק את הדומיין `digitalefficiency.co.il`)
- Anthropic Console
- GitHub (`digitalefficiency/restomatch`)

**מנהל הסיסמאות פתוח.** צור בו מראש תיקייה "RestoMatch rotation 1.11".

---

## 1. גיבוי (חובה, כ-2 דקות)

עושים בדיוק את שלבים 3 ו-4 של `docs/client-ready/RESEED-PROD.md`:
1. מקלידים `bash` ולוחצים Enter.
2. בלוק שלב 3: מזינים project ref, pooler host וסיסמת ה-DB **הנוכחית**. בשאלה על סיסמת הדמו לוחצים Enter, היא לא נדרשת כאן.
3. בלוק שלב 4: הגיבוי.

**מה צריך לראות:** בסוף שלב 3 `connected as postgres · restaurants: N`, ובסוף שלב 4 השורה **`✔ BACKUP OK: …`**.

**אם לא:**
- שגיאת סיסמה בשלב 3: הסיסמה הנוכחית לא ידועה. אפשר לעבור לצעד 2 (איפוס), ולחזור לגיבוי מיד אחריו עם הסיסמה החדשה. **לא ממשיכים לצעד 3 בלי `✔ BACKUP OK`.**
- אין `✔ BACKUP OK`: עוצרים. לא ממשיכים.

את חלון הטרמינל **לא סוגרים**. הוא נחוץ שוב בצעד 4.

---

## 2. איפוס סיסמת ה-DB (Supabase)

1. Supabase → הפרויקט → **Project Settings** → **Database**.
2. **Reset database password** → **Generate a password**.
3. **לפני שלוחצים Reset:** מעתיקים את הסיסמה ושומרים במנהל הסיסמאות בשם `DB password (postgres) 1.11`.
4. לוחצים **Reset password**.

**מה צריך לראות:** הודעה שהסיסמה עודכנה.

**שים לב:** מהרגע הזה האתר לא מצליח להתחבר למסד, עד שצעד 3 מסתיים וצעד 12 (Redeploy) רץ. זה הגיוני בחלון התחזוקה. עובדים ברצף.

---

## 3. `DATABASE_URL` ב-Vercel

**3א. מקודדים את הסיסמה במק.** בטרמינל (אותו חלון), מריצים. הטרמינל ישאל את הסיסמה ולא יציג אותה:

```bash
read -r -s -p "סיסמת ה-DB החדשה (לא תוצג): " NEWPW; echo
export DB_PW_ENC="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$NEWPW")"
unset NEWPW
export DATABASE_URL="postgresql://postgres.${RESEED_PROJECT_REF}:${DB_PW_ENC}@${SEED_ALLOW_REMOTE_HOST}:6543/postgres"
printf %s "$DATABASE_URL" | pbcopy && echo "✔ הועתק ללוח (לא מוצג)"
```

**3ב. ב-Vercel:** הפרויקט `project-6bs41` → **Settings** → **Environment Variables** → מחפשים `DATABASE_URL` → **⋯** → **Edit** → מדביקים (Cmd+V) בשדה Value → מוודאים שמסומן **Production** בלבד → **Save**.

**מה צריך לראות:** `DATABASE_URL` עם "Updated just now", סביבה Production.

**אם לא:** אם המשתנה סומן גם ל-Preview או Development, מורידים את הסימון. סודות של פרודקשן לא נכנסים ל-Preview.

**3ג. בודקים שהכתובת עובדת:**

```bash
psql "$DATABASE_URL" -Atc "select 'ok as ' || current_user"
```

**מה צריך לראות:** `ok as postgres`.
**אם לא:** `password authentication failed` → הסיסמה שהוקלדה לא זהה לזו ששמרת. חוזרים ל-3א.

---

## 4. תפקיד האפליקציה: `APP_ROLE_PASSWORD` ו-`DATABASE_URL_APP`

**4א. סיסמה חדשה לתפקיד.** במק:

```bash
openssl rand -hex 32 | pbcopy && echo "✔ סיסמה חדשה בלוח"
```

שומרים אותה (Cmd+V) במנהל הסיסמאות בשם `APP_ROLE_PASSWORD 1.11`. היא באורך 64 תווים, בלי רווחים או מרכאות, וזה מה שהסקריפט דורש (לפחות 24 תווים).

**4ב. מריצים את provision-rls מהמק, דרך ה-Session pooler (5432):**

```bash
read -r -s -p "APP_ROLE_PASSWORD (לא תוצג): " APP_ROLE_PASSWORD; echo
export APP_ROLE_PASSWORD
DATABASE_URL="postgresql://postgres.${RESEED_PROJECT_REF}:${DB_PW_ENC}@${SEED_ALLOW_REMOTE_HOST}:5432/postgres" \
  pnpm --filter @restomatch/db provision-rls
```

**מה צריך לראות:** שורות `[provision-rls] applying …`, ובסוף `[provision-rls] done.`.
- **לא** מוסיפים `--print-app-url`. הוא מדפיס את הסיסמה על המסך.

**אם לא:** `APP_ROLE_PASSWORD must be at least 24 characters` → הודבק משהו אחר. חוזרים ל-4א.

**4ג. בונים את `DATABASE_URL_APP` (transaction pooler 6543, המשתמש `restomatch_app.<ref>`):**

```bash
export DATABASE_URL_APP="postgresql://restomatch_app.${RESEED_PROJECT_REF}:${APP_ROLE_PASSWORD}@${SEED_ALLOW_REMOTE_HOST}:6543/postgres"
psql "$DATABASE_URL_APP" -Atc "select current_user, rolbypassrls from pg_roles where rolname=current_user"
```

**מה צריך לראות:** בדיוק **`restomatch_app|f`**.
- `f` אומר שהתפקיד **לא** עוקף את בידוד הלקוחות (RLS). האתר מסרב לעלות עם כל דבר אחר.

**אם לא:** `password authentication failed` → מריצים שוב את 4ב, ואז את 4ג.

**4ד. ב-Vercel:**
1. `APP_ROLE_PASSWORD` → Edit → מדביקים מהמנהל → Production בלבד → Save.
2. `DATABASE_URL_APP`: במק מריצים `printf %s "$DATABASE_URL_APP" | pbcopy`. ב-Vercel → Edit → מדביקים → **מבטלים את הסימון של Preview** (ושל Development אם מסומן) → Production בלבד → Save.

**מה צריך לראות:** שני המשתנים "Updated just now", ‏`DATABASE_URL_APP` מסומן **Production בלבד**.

---

## 5. מפתח סודי חדש ל-Supabase

1. Supabase → **Project Settings** → **API Keys** → לשונית **Secret keys** (או "API keys").
2. **+ New secret key** → שם: `restomatch-prod-2026-11` → **Create**.
3. מעתיקים את המפתח (מתחיל ב-`sb_secret_`) ושומרים במנהל הסיסמאות.
4. ב-Vercel, את **אותו** מפתח מכניסים ל**שני** המשתנים, Production בלבד:
   - `SUPABASE_SECRET_KEY` → Edit → Save.
   - `SUPABASE_SERVICE_ROLE_KEY` → Edit → Save.

**למה שניים:** הקוד מעדיף את `SUPABASE_SERVICE_ROLE_KEY` על פני `SUPABASE_SECRET_KEY` (`apps/web/lib/supabase/server.ts`). אם רק אחד יוחלף, האתר ימשיך להשתמש במפתח הישן.

**מה צריך לראות:** בשני המשתנים "Updated just now". ב-Supabase המפתח החדש מופיע ברשימה, והישן **עדיין פעיל**. מבטלים אותו רק בצעד 14, אחרי האימות.

---

## 6. `CRON_SECRET`

```bash
openssl rand -hex 32 | pbcopy && echo "✔ בלוח"
```

שומרים במנהל הסיסמאות, ואז Vercel → `CRON_SECRET` → Edit → מדביקים → Production → Save.

**מה צריך לראות:** "Updated just now". (Vercel Cron שולח את הערך הזה לבד אחרי ה-Redeploy.)

---

## 7. Resend: מפתח חדש ו-`EMAIL_FROM`

1. resend.com → בחר את **הצוות שמחזיק את הדומיין `digitalefficiency.co.il`** (בודקים ב-Domains: הסטטוס **Verified**).
2. **API Keys** → **Create API Key** → שם `restomatch-prod-2026-11` → Permission: **Sending access** → Domain: `digitalefficiency.co.il` → **Add**.
3. מעתיקים (מתחיל ב-`re_`) ושומרים במנהל הסיסמאות.
4. Vercel → `RESEND_API_KEY` → Edit → מדביקים → Production → Save.
5. Vercel → `EMAIL_FROM` → Edit → הערך:
   ```
   RestoMatch <noreply@digitalefficiency.co.il>
   ```
   → Production → Save.

**מה צריך לראות:** ב-Resend הדומיין Verified והמפתח החדש ברשימה. ב-Vercel שני המשתנים מעודכנים.

**אם לא:** אם הדומיין לא מופיע בצוות שבחרת, עוברים צוות (בפינה השמאלית העליונה). אם הוא לא Verified בשום צוות, עוצרים את צעד 7 וממשיכים; המיילים ימשיכו להיכשל עד שמאמתים את הדומיין.

---

## 8. משתנים חדשים (Vercel → Add New, ‏Production בלבד)

| משתנה | ערך |
|---|---|
| `WORKER_ALERT_EMAILS` | כתובת המייל שלך (אפשר כמה, מופרדות בפסיק) |
| `HEALTH_DIGEST_EMAILS` | כנ״ל |
| `PLATFORM_ADMIN_EMAILS` | כנ״ל. הכתובות האלה מקבלות גישה ל-`/admin`, אז רק שלך |
| `SERVERLESS_CRON_SKIP` | `order-reminders-09,supplier-delays-10,end-of-day-report-19,price-alerts-07,recovery-reminders-0830,monthly-report-1st-0745` |

**למה `SERVERLESS_CRON_SKIP`:** מרגע שהמיילים יעבדו, המשימות היומיות של הדמו היו מתחילות לשלוח מיילים לכתובות `.test`. זה זמני: **מוחקים את המשתנה ביום ד׳ 4.11 ב-12:30**, לפני בניית RC1.

**אופציונלי:** מפתח Anthropic חדש מה-workspace הייעודי `restomatch-prod` (Anthropic Console → Workspaces → `restomatch-prod` → Limits: ‏$100 לחודש → API Keys → Create). שומרים במנהל הסיסמאות → Vercel → `ANTHROPIC_API_KEY` → Edit → Save.

**מה צריך לראות:** ארבעת המשתנים ברשימה, Production.

---

## 9. מחיקת משתנים ישנים מ-Vercel

Vercel → Environment Variables → לכל אחד: **⋯** → **Remove** → מאשרים:

`REDIS_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE`, `SUPABASE_JWT_SECRET`.

**את `DEMO_PASSWORD` לא מוחקים עכשיו.** רק אחרי צעד 15.

**מה צריך לראות:** אף אחד מהשמות האלה לא מופיע ברשימה.

**9ב. GitHub:** `github.com/digitalefficiency/restomatch` → **Settings** → **Secrets and variables** → **Actions**. קוראים את **השמות** בלבד. כל secret שהחזיק ערך שהוחלף היום (`DEMO_PASSWORD`, `DATABASE_URL`, `CRON_SECRET`, `SUPABASE_*`): או **Update** עם הערך החדש, או **Remove** אם לא בשימוש. אם אינך בטוח אם הוא בשימוש, מעדכנים (לא מוחקים).

---

## 10. `AUTH_URL` ו-`APP_URL`

ב-Vercel פותחים את שניהם (Edit, בלי לשנות) ובודקים שהערך הוא **בדיוק**:

```
https://restomatchrrr.vercel.app
```

בלי `/` בסוף. אם לא, מתקנים ושומרים.

## 11. Fluid compute

Vercel → **Settings** → **Functions** → **Fluid Compute** → צריך להיות **Enabled**. אם לא: מפעילים → **Save**.

---

## 12. ביטול מיילים תקועים של הדמו, ואז Redeploy

**12א.** Supabase → **SQL Editor** → New query. קודם ספירה:

```sql
select count(*) from notifications_outbox
where status in ('queued','sending')
  and restaurant_id in (select id from restaurants where coalesce(business_id,'')='514778123' or name like 'כפר הזיתים%');
```

**מה צריך לראות:** מספר (גם 0 תקין). רושמים אותו.

**12ב.** ואז, באותו עורך:

```sql
begin;
update notifications_outbox
   set status='cancelled', last_error='suppressed: demo tenant during pilot prep (W4)'
 where status in ('queued','sending')
   and restaurant_id in (select id from restaurants where coalesce(business_id,'')='514778123' or name like 'כפר הזיתים%');
commit;
```

**מה צריך לראות:** `UPDATE N` כשה-N זהה לספירה מ-12א, ואז `COMMIT`.
**אם לא:** אם N שונה מאוד מהספירה, עוצרים ושולחים למפתחים את שני המספרים.

**12ג. Redeploy:** Vercel → **Deployments** → הבנייה החיה (מסומנת **Current**, היום `dpl_E7aMmfFRJQTpsdBtVxUmCErbJ2BD`, קומיט `389908ba`) → **⋯** → **Redeploy** → **בלי** לסמן "Use existing Build Cache" אם מוצעת האפשרות → Redeploy.

**מה צריך לראות:** בנייה חדשה, שמגיעה ל-**Ready** תוך כמה דקות.

**12ד. Promote:** בבנייה החדשה → **⋯** → **Promote** → מאשרים. (הפרויקט מוגדר כך שבנייה חדשה **לא** עולה לבד לכתובת `restomatchrrr.vercel.app`.)

**מה צריך לראות:** הבנייה החדשה מסומנת **Current**.

---

## 13. אימות (כ-10 דקות)

| בדיקה | איך | מה צריך לראות |
|---|---|---|
| בריאות | פותחים `https://restomatchrrr.vercel.app/api/healthz` | תשובה 200 עם `"status": "ok"`, והשדה `commit` = הקומיט של הבנייה החדשה (זה לא בודק את המסד; לכן גם בדיקת הכניסה) |
| משימות מתוזמנות | Vercel → **Logs** → מחפשים `/api/cron/jobs` (מחכים עד 2 דקות) | 200. **אין** `28P01`, **אין** 401, **אין** `DATABASE_URL_APP … not used as is` |
| כניסה | מתחברים כבעלים | הדשבורד עולה |
| סריקה | נכנסים לחשבונית עם סריקה ופותחים אותה | התמונה נטענת |
| מייל | ב-`/reset` מבקשים איפוס סיסמה לכתובת **שלך** | המייל מגיע תוך דקה, **לא** בספאם, מ-`noreply@digitalefficiency.co.il` |
| עותקים שחזרו | Vercel → Environment Variables | אף אחד מ-`POSTGRES_*` / `SUPABASE_JWT_SECRET` לא חזר |

**על העותקים שחזרו:** האינטגרציה Vercel ↔ Supabase יכולה ליצור אותם מחדש. אם הם חזרו, מוחקים שוב (צעד 9). **לא** מסירים את האינטגרציה עכשיו.

---

## 14. ביטול המפתחות הישנים (רק אחרי שצעד 13 עבר)

1. Supabase → Project Settings → **API Keys** → המפתח הסודי **הישן** → **⋯** → **Delete** / **Revoke**.
2. אם מפתח ה-`service_role` הישן (JWT, ‏מתחיל ב-`eyJ`) נחשף אי פעם: באותו מסך, לשונית **Legacy API keys** → **Disable legacy API keys**. לפני כן ודא ש-`SUPABASE_SERVICE_ROLE_KEY` ב-Vercel מתחיל ב-`sb_secret_` (את התחילית בלבד).
3. Resend → **API Keys** → המפתח **הישן** → **Delete**.

**מה צריך לראות:** רק המפתחות החדשים ברשימות. אחר כך חוזרים על בדיקת הסריקה והמייל מצעד 13.

**אם משהו נשבר אחרי הביטול:** אחד המשתנים עדיין מחזיק מפתח ישן. בודקים את צעדים 5 ו-7, מתקנים, Redeploy ו-Promote.

---

## 15. הדמו (עד 13:00)

בוחרים **אחת**:
- **א. הדמו נשאר נעול:** משתמשי הדמו לא נכנסים. לא עושים כלום נוסף.
- **ב. זורעים מחדש עם סיסמה חדשה:** לפי `docs/client-ready/RESEED-PROD.md` שלבים 3–7, עם `DEMO_PASSWORD` **חדש** מהמנהל, ובלי `DEMO_PLATFORM_ADMIN` (לא מריצים `export DEMO_PLATFORM_ADMIN=1`).

**ואחרי שתי האפשרויות:** Vercel → `DEMO_PASSWORD` → **Remove**. האתר לא קורא אותו, והסיסמה נשמרת רק במנהל הסיסמאות.

**מה צריך לראות:** באפשרות ב׳ השורה `✔ demo data coherent` ו-`db:doctor` עם 0 FAIL.

---

## 16. בדיקה אחרי חשיפה (קריאה בלבד)

מטרה: לוודא שאף אחד לא השאיר "דלת אחורית" בזמן שהסודות היו חשופים. מריצים ב-Supabase → SQL Editor, כל שאילתה בנפרד. **אף שאילתה כאן לא משנה נתונים.**

```sql
-- 1. תפקידים שיכולים להתחבר או לעקוף RLS
select rolname, rolcanlogin, rolbypassrls, rolsuper from pg_roles
where rolcanlogin or rolbypassrls order by rolname;

-- 2. מדיניות ה-Storage
select policyname, cmd, roles from pg_policies where schemaname='storage' order by policyname;

-- 3. הרשאות של anon/authenticated על טבלאות public (צריך 0)
select count(*) from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated');

-- 4. טבלאות public בלי RLS
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by relname;

-- 5. מנגנוני התמדה
select evtname, evtevent, evtowner::regrole from pg_event_trigger;
select extname, extversion from pg_extension order by extname;
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' order by p.proname;
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal order by tgrelid::regclass::text, tgname;
select srvname from pg_foreign_server;
select pubname from pg_publication;
select count(*) from auth.users;
-- רק אם pg_cron מופיע ברשימת ההרחבות למעלה:
-- select jobid, schedule, command from cron.job;
```

**מה צריך לראות:**
1. רק התפקידים המוכרים: `postgres`, `restomatch_app` (‏`rolbypassrls=f`), ותפקידי Supabase (`supabase_*`, `authenticator`, `pgbouncer`, `service_role` וכו'). **כל שם לא מוכר = עוצרים ומדווחים.**
2. ארבע מדיניות `invoice_scans…`, בלי `walk-ins`.
3. `0`.
4. רשימה ריקה, או רק טבלאות שאין בהן `restaurant_id` (טבלאות מערכת).
5. אין event triggers שלא של Supabase; אין foreign servers; publications של Supabase בלבד; פונקציות ו-triggers עם שמות שמוכרים מהקוד; `auth.users` לא גדל באופן לא מוסבר.

**לוגים:** Supabase → **Logs** → Postgres / Auth / API, מהתאריך המוקדם ביותר שזמין. **בתוכנית Free נשמר בערך יום אחד בלבד.** לכן צריך לכתוב במפורש: **את התקופה מ-18.10 ועד היום אי אפשר לבדוק בלוגים.**

**רישום:** הקובץ `docs/legal/BREACH-RESPONSE.md` שייך לצוות אחר (W1-12). אל תערוך אותו. העבר להם את הרשומה הזו, מוכנה להדבקה:

```markdown
### 2026-11-01 — rotation after secret exposure (18.10–31.10)
- Exposed: DB password (postgres), CRON_SECRET, Supabase secret/service-role key, DEMO_PASSWORD, Resend key; shared in chats/screenshots, no evidence of misuse found.
- Rotated 2026-11-01 07:30–10:00 IST by Rom: all of the above + APP_ROLE_PASSWORD/DATABASE_URL_APP. AUTH_ENC_KEY intentionally kept (2FA).
- Old Supabase secret key and Resend key revoked: <time>. Legacy JWT keys disabled: <yes/no>.
- Post-exposure SQL review: roles <ok/finding>, storage policies <ok/finding>, anon grants <0/n>, tables without RLS <none/list>, persistence objects <none/list>, auth.users <n>.
- Log review: Supabase Free keeps ~1 day; the window 2026-10-18 → 2026-10-31 could not be reviewed.
- Follow-ups: <list or "none">.
```

---

## אם משהו נשבר באמצע

| סימפטום | מה בודקים |
|---|---|
| הכניסה לאתר נכשלת / 500 | `DATABASE_URL` ו-`DATABASE_URL_APP`: הסיסמה מקודדת? פורט 6543? המשתמש `postgres.<ref>` / `restomatch_app.<ref>`? אחרי תיקון: Redeploy + Promote |
| `/api/cron/jobs` מחזיר 401 | `CRON_SECRET` לא נשמר, או שלא עשית Redeploy אחרי השינוי |
| מיילים לא מגיעים | `EMAIL_FROM` חייב להיות בדומיין `digitalefficiency.co.il`, והמפתח מאותו צוות ב-Resend |
| סריקות לא נפתחות | `SUPABASE_SERVICE_ROLE_KEY` ו-`SUPABASE_SECRET_KEY` — שניהם עם המפתח החדש |
| האתר לא עולה בכלל | Vercel → Logs → השורה שמתחילה ב-`[env]` אומרת מה חסר |

**בסוף:** סוגרים את חלון הטרמינל. זה מוחק את הסיסמאות מהזיכרון. ורושמים ב-`docs/ops/OPS-LOG.md` את סיום ההחלפה.

</div>
