# גיבוי ושחזור — פרודקשן RestoMatch

<div dir="rtl">

**למי:** רום. כל צעד מבוצע ידנית. אף סוכן לא מבצע אותו.

**שלושה סוגי גיבוי:**

| מה | מתי | איפה נשמר |
|---|---|---|
| גיבוי יומי של Supabase (אוטומטי) | כל יום, אחרי מעבר ל-Pro | אצל Supabase, 7 ימים |
| `pg_dump` ידני | **לפני כל Promote**, וכל יום א׳ | במק, בתיקייה מוצפנת |
| העתק של קבצי הסריקות (`invoice-scans`) | כל יום א׳ | במק, בתיקייה מוצפנת, 4 עותקים אחרונים |

> ⛔ **לעולם לא משחזרים את פרויקט הפרודקשן כדי "לתקן" את הדמו.** שחזור מחזיר את **כל** המסעדות לרגע הגיבוי, ומוחק כל מה שלקוחות אמיתיים (ציקטי) עשו מאז. לדמו יש סקריפט משלו: `docs/client-ready/RESEED-PROD.md`.

---

## 1. מעבר ל-Supabase Pro (חד-פעמי, עד ב׳ 2.11)

בתוכנית Free **אין גיבויים אוטומטיים**.

1. Supabase → הארגון → **Billing** → **Change plan** → **Pro** (‏$25 לחודש) → מאשרים תשלום.
2. למחרת: Supabase → הפרויקט → **Database** → **Backups** → **Scheduled backups**.

**מה צריך לראות:** ביום שאחרי המעבר מופיע גיבוי אחד לפחות, עם תאריך של היום הקודם.

**אם לא:** אחרי 48 שעות עדיין אין גיבוי → פונים לתמיכה של Supabase (Support → New ticket). עד אז ממשיכים עם `pg_dump` ידני (סעיף 2) **כל יום**.

רושמים ב-`docs/ops/OPS-LOG.md`: "מעבר ל-Pro" ותאריך הגיבוי הראשון שנראה.

---

## 2. `pg_dump` ידני (לפני כל Promote, וכל יום א׳)

**2א. תיקייה מוצפנת (חד-פעמי):**
1. Disk Utility → **File** → **New Image** → **Blank Image**.
2. שם: `restomatch-backups`, גודל 2GB, **Encryption: 256-bit AES**, סיסמה ממנהל הסיסמאות.
3. שומרים, ופותחים (double-click). היא מופיעה כ-`/Volumes/restomatch-backups`.

**2ב. הגיבוי:** פותחים את התיקייה המוצפנת, ואז בטרמינל עושים את שלבים 3 ו-4 של `docs/client-ready/RESEED-PROD.md` (מתחילים ב-`bash`), עם שינוי אחד: לפני בלוק שלב 4 מריצים:

```bash
mkdir -p /Volumes/restomatch-backups/db && ln -sfn /Volumes/restomatch-backups/db ~/restomatch-backups
```

כך הגיבוי נשמר בתוך התיקייה המוצפנת. (בשאלה על סיסמת הדמו בשלב 3 לוחצים Enter.)

**מה צריך לראות:** `✔ BACKUP OK: …`, גודל של מאות KB לפחות, `tables with data:` מעל 40.

**אם לא:** אין `✔ BACKUP OK` → **לא עושים Promote**. מנסים שוב; אם נכשל פעמיים, פונים למפתחים עם הודעת השגיאה (בלי כתובת ובלי סיסמה).

**בסוף:** סוגרים את חלון הטרמינל, ו-Eject לתיקייה המוצפנת.

---

## 3. העתק שבועי של קבצי הסריקות (כל יום א׳)

גיבויי Supabase כוללים רק את מסד הנתונים, **לא** את תמונות החשבוניות.

**חד-פעמי:** `brew install supabase/tap/supabase`, ואז `supabase login` (נפתח דפדפן).

**כל שבוע** (התיקייה המוצפנת פתוחה):

```bash
cd ~/restomatch && supabase link --project-ref <PROJECT_REF>
mkdir -p /Volumes/restomatch-backups/scans
supabase storage cp -r ss:///invoice-scans "/Volumes/restomatch-backups/scans/invoice-scans-$(date +%F)" --experimental
ls "/Volumes/restomatch-backups/scans/invoice-scans-$(date +%F)" | head
```

(`<PROJECT_REF>`: 20 התווים מ-Supabase → Connect, אחרי `postgres.`.)

**מה צריך לראות:** תיקייה חדשה עם תת-תיקיות לפי מסעדה, ובהן קבצי תמונה/PDF.

**אם לא:** `supabase link` מבקש סיסמת DB → מקלידים אותה (לא מוצגת). שגיאה אחרת → `docs/BACKUPS-STAGING.md` סעיף 3 מתאר חלופה (S3).

**שומרים 4 עותקים אחרונים.** את הישנים מוחקים מהתיקייה המוצפנת.

---

## 4. תרגיל שחזור — יום ד׳ 4.11 (חובה, כשעה)

**מטרה:** להוכיח שגיבוי אמיתי אפשר לשחזר, ולמדוד כמה זמן זה לוקח (RTO). משחזרים **למסד מקומי במק**, לא לפרויקט Supabase ולא לפרודקשן.

**4א. מסד מקומי, Postgres 17 עם pgvector.** אחת משתי הדרכים:
- **Docker** (מומלץ):
  ```bash
  docker run -d --name rm-restore -p 55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg17
  sleep 5 && psql "postgresql://postgres@localhost:55432/postgres" -Atc "select version()"
  ```
- **Postgres.app** עם גרסה 17, ואז `CREATE EXTENSION vector` צריך לעבוד.

**מה צריך לראות:** `PostgreSQL 17.x …`.

**4ב. מכינים את המסד** (רושמים את שעת ההתחלה, זה תחילת מדידת ה-RTO):

```bash
date "+start %H:%M:%S"
export LOCAL="postgresql://postgres@localhost:55432/restore_drill"
psql "postgresql://postgres@localhost:55432/postgres" -c "create database restore_drill"
psql "$LOCAL" -c 'create extension if not exists vector; create extension if not exists pg_trgm; create extension if not exists "uuid-ossp";'
for r in anon authenticated service_role restomatch_app; do psql "$LOCAL" -c "create role $r nologin" 2>/dev/null; done
```

(התפקידים נוצרים כדי שמדיניות ה-RLS שמזכירות אותם ישוחזרו.)

**4ג. השחזור** (הגיבוי האחרון מסעיף 2):

```bash
export BACKUP="$(ls -t /Volumes/restomatch-backups/db/prod-*.dump | head -1)"; echo "$BACKUP"
pg_restore --no-owner --no-acl -d "$LOCAL" "$BACKUP" 2> ~/restore-errors.txt
grep -c ERROR ~/restore-errors.txt; grep ERROR ~/restore-errors.txt | sort | uniq -c | head -20
```

**שגיאות צפויות (תקין):** הגיבוי כולל רק את הסכמות שלנו (`public`, `app`, `drizzle`, `supabase_migrations`). שגיאות שמזכירות סכמות או פונקציות של Supabase בלבד — `auth`, `storage`, `graphql`, `realtime`, `extensions`, `pgsodium`, `vault`, ‏`auth.uid()` וכדומה — צפויות ואינן בעיה.

**שגיאה לא צפויה:** כל שגיאה על טבלה שלנו (`restaurants`, `invoices`, `invoice_lines` וכו') או `duplicate key`. → מעתיקים את השורה (בלי כתובות) ושולחים למפתחים.

**4ד. בדיקת תקינות:**

```bash
cd ~/restomatch && DATABASE_URL="$LOCAL" pnpm db:doctor
```

**מה צריך לראות:** כל הבדיקות **PASS**, למעט בדיקות שתלויות ב-Supabase (למשל `Supabase Data API locked out`, בדיקות `storage`), שמותר להן להיכשל מקומית.

**4ה. ספירת שורות** — משווים לפרודקשן:

```bash
Q="select 'restaurants',count(*) from restaurants union all select 'memberships',count(*) from memberships union all select 'suppliers',count(*) from suppliers union all select 'invoices',count(*) from invoices union all select 'invoice_lines',count(*) from invoice_lines union all select 'audit_log',count(*) from audit_log"
psql "$LOCAL" -Atc "$Q"
date "+end %H:%M:%S"
```

ואת אותה שאילתה (`$Q` בלי ה-`psql`) מריצים בפרודקשן ב-Supabase → **SQL Editor**.

**מה צריך לראות:** אותם מספרים בשתי הרשימות (או פרודקשן גבוה מעט, אם נוספו נתונים אחרי הגיבוי).

**4ו. רישום:** ב-`docs/ops/OPS-LOG.md` כותבים: קובץ הגיבוי (שם בלבד), מספר השגיאות הצפויות/לא צפויות, תוצאת `db:doctor`, ספירות, ו-**RTO = end − start**.

**4ז. ניקוי:**

```bash
docker rm -f rm-restore; rm -f ~/restore-errors.txt
```

---

## 5. שחזור אמיתי לפרודקשן

רק אם נתונים של לקוח אמיתי באמת אבדו, ורק אחרי שיחה עם המפתחים. התהליך: `docs/client-ready/RESEED-PROD.md` סעיף 8 ("שחזור"). אחרי שחזור: `pnpm db:doctor` חייב להחזיר 0 FAIL, ובודקים כניסה וסריקה כמו ב-`ROTATION-2026-11.he.md` צעד 13.

</div>
