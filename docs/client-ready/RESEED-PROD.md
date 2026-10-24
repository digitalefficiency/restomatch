# איפוס וזריעה מחדש של נתוני הדמו בפרודקשן

<div dir="rtl">

**למי:** הבעלים. רצים מהמק דרך ה-Session pooler של Supabase.

**איך עובדים עם המסמך:**
- כל שלב הוא **בלוק אחד**. מעתיקים את כל הבלוק, מדביקים בטרמינל ולוחצים Enter.
- כל השלבים רצים **באותו חלון טרמינל**, מההתחלה עד הסוף.
- סיסמאות מקלידים רק כשהטרמינל שואל. הן **לא מופיעות על המסך** בזמן ההקלדה, וזה תקין.
- לא מדביקים סיסמה בצ'אט, בקובץ או בהודעה.

**מה זה עושה:**
- מוחק **רק** את מסעדות הדמו: "כפר הזיתים" והסניפים "כפר הזיתים — חיפה" ו"כפר הזיתים — ירושלים".
- כולל כל מה שהוספת אליהן בבדיקות: חשבוניות, כפילויות, קבלות סחורה, משתמשים שהוזמנו לדמו.
- זורע אותן מחדש ליום ההצגה, **25/10/2026**.

**מה זה לא עושה:**
- לא נוגע באף מסעדה אחרת.
- הסקריפט סופר את השורות של כל השאר לפני ואחרי, ונכשל אם משהו השתנה. תור העבודות של ה-worker (`job_queue`) לא נספר: ה-worker מוסיף לו שורות לבד כל דקה.

**הסדר:** הכנה (1) ← שלושה ערכים מ-Supabase (2) ← הזנה (3) ← **גיבוי (4, חובה)** ← בדיקה יבשה (5) ← הרצה (6) ← אימות (7).

> ⚠️ **בתוכנית החינמית של Supabase אין גיבויים אוטומטיים.** לכן שלב 4 (גיבוי מהמק) הוא חובה. בלי קובץ גיבוי תקין לא ממשיכים לשלב 5.

---

## 1. הכנה חד-פעמית במק

רק בפעם הראשונה. אם כבר עשית את זה, מדלגים לשלב 2, אבל מריצים את שתי השורות האחרונות (`git pull` ו-`pnpm install`) כדי לקבל את הגרסה העדכנית.

```bash
brew install libpq && brew link --force libpq
corepack enable && corepack prepare pnpm@10.33.0 --activate
cd ~ && [ -d restomatch ] || git clone https://github.com/digitalefficiency/restomatch.git
cd ~/restomatch && git checkout main && git pull
pnpm install --frozen-lockfile
```

- צריך Node 22. בדיקה: `node -v` מחזיר `v22.x`.
- `pg_dump --version` צריך להחזיר 17 ומעלה.

## 2. שלושה ערכים מ-Supabase

ב-Supabase: **Connect** (למעלה) ← **Session pooler** ← רואים URI כזה:

```
postgresql://postgres.<PROJECT_REF>:[YOUR-PASSWORD]@<POOLER_HOST>:5432/postgres
```

צריך משם שלושה דברים:
1. **Project ref**: 20 התווים שבשם המשתמש, אחרי `postgres.`.
2. **Pooler host**: הכתובת שאחרי ה-`@`, למשל `aws-0-ap-northeast-1.pooler.supabase.com`.
3. **סיסמת ה-DB**: אותה סיסמה של Project Settings ← Database. אם אינך זוכר אותה, **לא לאפס אותה** בלי לבדוק קודם עם המפתחים, כי האתר משתמש בה.

**איזה DATABASE_URL? חשוב:**
- הזריעה רצה עם משתמש הבעלים **`postgres.<ref>`** דרך **Session pooler, פורט 5432**. זה מה שבלוק 3 בונה.
- **לא** להשתמש בכתובת מ-Vercel. האתר משתמש במשתמש `restomatch_app` בפורט 6543, ואין לו הרשאה למחוק ולזרוע.

## 3. הזנת הערכים (בלי סיסמאות על המסך)

**קודם, לבד בשורה:** מקלידים `bash` ולוחצים Enter. הטרמינל של המק עובד כברירת מחדל ב-zsh, ושם הבלוקים האלה לא עובדים. מכאן ועד הסוף נשארים באותו חלון.

```bash
bash
```

ואז מעתיקים את כל הבלוק הבא. הטרמינל ישאל ארבע שאלות, אחת אחרי השנייה:

```bash
cd ~/restomatch
read -r -p "Project ref (20 תווים): " RESEED_PROJECT_REF
read -r -p "Pooler host (aws-0-....pooler.supabase.com): " SEED_ALLOW_REMOTE_HOST
read -r -s -p "סיסמת ה-DB (לא תוצג): " DBPW; echo
read -r -s -p "סיסמה חדשה למשתמשי הדמו, מהמנהל סיסמאות (לא תוצג): " DEMO_PASSWORD; echo
export RESEED_PROJECT_REF SEED_ALLOW_REMOTE_HOST DEMO_PASSWORD
export DEMO_TODAY=2026-10-25
export DATABASE_URL="postgresql://postgres.${RESEED_PROJECT_REF}:$(printf %s "$DBPW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(encodeURIComponent(s)))')@${SEED_ALLOW_REMOTE_HOST}:5432/postgres"
unset DBPW
psql "$DATABASE_URL" -Atc "select 'connected as ' || current_user || ' · restaurants: ' || count(*) from restaurants"
```

**מה צריך לראות בסוף:** `connected as postgres · restaurants: N`.
- אם מופיעה שגיאת סיסמה: מריצים את הבלוק שוב ומקלידים בזהירות.
- אם מופיע `timeout`: Supabase בתקלה. מחכים ומנסים שוב. **לא ממשיכים.**

**סיסמת משתמשי הדמו:**
- בוחרים סיסמה חדשה ושומרים אותה **קודם** במנהל הסיסמאות. איתה מתחברים לדמו מחר.
- הסקריפט מסרב לסיסמת ברירת המחדל שמופיעה בקוד.

**למה שלושה מזהים?** ה-host של ה-pooler משותף לכל הפרויקטים באזור. הסקריפט רץ רק אם גם ה-host וגם ה-project ref תואמים. כך אי אפשר לזרוע בטעות לפרויקט אחר.

**`/admin` בדמו:** כברירת מחדל, משתמש הדמו `owner@` **לא** מקבל הרשאת מנהל פלטפורמה בפרודקשן. `/admin` מציג את כל המסעדות, כולל לקוחות אמיתיים. אם חייבים להציג את `/admin`, מריצים `export DEMO_PLATFORM_ADMIN=1` לפני שלב 6, ואחרי ההצגה מריצים את שלב 6 שוב בלעדיו.

## 4. גיבוי (חובה, לפני כל שינוי, כ-1 דקה)

```bash
mkdir -p ~/restomatch-backups
export BACKUP="$HOME/restomatch-backups/prod-$(date +%Y%m%d-%H%M).dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner \
  --schema=public --schema=app --schema=drizzle --schema=supabase_migrations \
  --file "$BACKUP" \
&& ls -lh "$BACKUP" \
&& echo "tables with data: $(pg_restore --list "$BACKUP" | grep -c 'TABLE DATA')" \
&& pg_restore --list "$BACKUP" | grep -q "TABLE DATA public restaurants" && echo "✔ BACKUP OK: $BACKUP"
```

**מה צריך לראות:**
- גודל קובץ של מאות KB לפחות.
- `tables with data:` מעל 40.
- השורה האחרונה: `✔ BACKUP OK: ...`.

**אם אין `✔ BACKUP OK`: עוצרים. לא ממשיכים לשלב 5.**

מה הגיבוי כולל ומה לא:
- הוא כולל את כל הנתונים, הטבלאות, ההרשאות וההיסטוריה של המיגרציות.
- הוא **לא** כולל קבצי סריקות (Storage). איפוס הדמו לא נוגע בהם.

## 5. בדיקה יבשה (dry-run): לא משנה כלום

```bash
pnpm --filter @restomatch/worker reseed:demo -- --today "$DEMO_TODAY" --dry-run
```

**מה צריך לראות:**
- `DEMO_TODAY=2026-10-25 · DRY RUN (nothing is changed)`.
- `demo tenants found:` עם עד שלוש מסעדות. בהרצה ראשונה: `none (first seed)`.
- טבלה של כמה שורות יימחקו. זה רק הדמו: invoices, goods_receipts, users של `@kfar-hazeitim.test` וכו'.
- `other tenants (left untouched): N restaurant(s)`: כמה מסעדות אמיתיות יישארו בלי שינוי.

**אם מופיע `refusing: the demo tenants are mixed with real data`: עוצרים.**
- ההודעה אומרת בדיוק מה מעורבב, למשל משתמש אמיתי שהוזמן למסעדת הדמו.
- מוציאים אותו מהצוות של הדמו דרך המסך "צוות", ומריצים שוב את שלב 5.

## 6. ההרצה האמיתית

```bash
pnpm --filter @restomatch/worker reseed:demo -- --today "$DEMO_TODAY"
```

- זה לוקח כ-2–4 דקות.
- בסוף אמורות להופיע השורות `✔ done. Other tenants unchanged (...)` ו-`✔ demo data coherent`, יחד עם המספרים משלב 7.
- **אם משהו נכשל באמצע:** שום דבר מחוץ לדמו לא נגע. מתקנים את הסיבה ומריצים **את אותה פקודה שוב**. הפעולה בטוחה להרצה חוזרת.

## 7. אימות

```bash
pnpm --filter @restomatch/worker check:demo && pnpm db:doctor
```

**מה צריך לראות.** המספרים נבדקו מקומית על `main` עם `DEMO_TODAY=2026-10-25`:

```
[check-demo]   hero: ₪760 of ₪42263 (1.8%)
[check-demo]   last month ₪1059 of ₪69541 (1.5%) · month before ₪1042 of ₪62028 (1.7%)
[check-demo]   today 2026-10-25: HaSharon Produce (11 lines, sent), HaKerem Butchery (6 lines, sent), Galilee Dairies (7 lines, sent)
[check-demo]   produce VAT: HaSharon Produce 0%, HaSharon Produce 0%, Carmel Greens 0%, HaSharon Produce 0% · VAT_MISMATCH on produce: 0
[check-demo]   consolidated: GD-M-202605 paid 9/9 notes, GD-M-202606 paid 8/8 notes, GD-M-202607 paid 9/9 notes, GD-M-202608 paid 9/9 notes, GD-M-202609 parsed 8/8 notes · overcharge ₪36.00, BR-R-24123 parsed 2/2 notes
[check-demo]   VAT at risk (no allocation number, > ₪5,000): MF-24950 · ₪1123.20
[check-demo]   approvals queue (main): 5 open
[check-demo]   כפר הזיתים — חיפה: 203 invoices · leak ₪355 of ₪61740 (0.6%)
[check-demo]   כפר הזיתים — ירושלים: 203 invoices · leak ₪975 of ₪33056 (2.9%)
[check-demo] ✔ demo data coherent
```

**אחרי שנתוני גל 1 נכנסו ל-main** (החזרים, מתכונים, ספירות מלאי, חוזי מחיר) מופיעות גם השורות האלה. בשלב 6 ההרצה מדפיסה `feature seed …: will run` לכל אחד מהם:

```
[check-demo]   recovery: 74 claims, 64 staged
[check-demo]   recipes: 10 dishes, 59 items
[check-demo]   inventory: 2026-09-30 ₪11134.46, 2026-10-24 ₪13474.46 (sales ₪136400.00)
[check-demo]   inventory: actual food cost 30.2% (₪41135.36 of ₪136400.00)
[check-demo]   contracts: 10 contract prices, 1 price alerts
```

- אם בבדיקה היבשה (שלב 5) מופיע `refusing: feature seed(s) not scoped to the demo tenants`, **עוצרים**. אחד מסקריפטי גל 1 עוד לא מוגבל למסעדות הדמו, ולא מריצים אותו על פרודקשן. מעבירים את ההודעה למפתחים.
- אם מופיע `a feature seed moved the leak hero`, עוצרים ושולחים למפתחים.

ואחר כך מ-`db:doctor`: **0 FAIL**.

**מה הקובע:** השורה `✔ demo data coherent` ו-0 FAIL.
- אם שינויים שנכנסו ל-`main` אחרי הבדיקה הזיזו מעט מספר, זה תקין כל עוד מופיע ה-✔.
- אם מופיע `✘` במקום ה-✔: עוצרים ושולחים למפתחים את השורות שמתחילות ב-`✘`. **בלי** סיסמאות וכתובות.

מה זה אומר במסך:

| מה | ערך |
|---|---|
| כפר הזיתים: דלף החודש | **₪760** מתוך ₪42,263 רכש לפני מע״מ (**1.8%**) |
| נתפס לפני תשלום / הוחזר מספקים | ₪296 / ₪464 |
| חשבוניות עם דליפה | 13 מתוך 37 |
| תור אישורים | 5 פתוחים, ו-2 חשבוניות ריכוז ממתינות לשיוך, ‏3,603 ₪ (רגוע, לא התראה) |
| מחלבות הגליל: תעודות משלוח וחשבונית מרכזת | חשבונית מרכזת לספטמבר GD-M-202609 על 8 תעודות משלוח, ממתינה. בתעודה 61036 חלב חויב ‏7.90 ₪ במקום ‏6.40 ₪: **‏36 ₪** לפני מע״מ. באוקטובר 8 תעודות שעוד לא חויבו (החשבונית בסוף החודש). מאי–אוגוסט: חשבוניות מרכזות ששולמו |
| קבלת סחורה היום (25/10) | **ירקות השרון 10:00** (11 שורות, פתוחה, להדגמה חיה), קצביית הכרם 12:30, מחלבות הגליל 15:00 |
| ירקות (ירקות השרון, Carmel Greens) | מע״מ 0% (פטור), בלי ממצאי מע״מ |
| חודשים קודמים | אוגוסט ₪1,042 מתוך ₪62,028 (1.7%) · ספטמבר ₪1,059 מתוך ₪69,541 (1.5%) |
| השוואות אוקטובר מול ספטמבר | בעמוד הבית ללא שינוי: "חודש שעבר: ‏1,059 ₪", ומול התקופה המקבילה דליפה **ירידה של 1.9%** והוצאה **ירידה של 16.8%**. בתצוגת "חודש שעבר": **1.5%** מתוך ‏69,541 ₪, הוצאה **עלייה של 12.1%** מול אוגוסט, **18 מתוך 53**. בטבלת המגמה ברשת: ספטמבר של כפר הזיתים **1.5%** |
| מע״מ בסיכון | חשבונית אחת: הדגים הים-תיכוניים MF-24950 מ-28/9, ‏6,240 ₪ לפני מע״מ, בלי מספר הקצאה: **‏1,123.20 ₪** מע״מ בסיכון |
| סניף חיפה | ₪355 מתוך ₪61,740 (0.6%) |
| סניף ירושלים | ₪975 מתוך ₪33,056 (2.9%) |

**ההתחברות:**
- משתמשים: `owner@kfar-hazeitim.test`, וגם `manager@`, `receiver@` (באנגלית), `bookkeeper@` ו-`chef@`.
- סיסמה: זו ששמרת במנהל הסיסמאות בשלב 3.

**בסוף סוגרים את חלון הטרמינל.** זה מוחק את הסיסמאות והכתובת מהזיכרון.

## 8. אם צריך לחזור אחורה

הסקריפט לא נוגע במסעדות אחרות, ולכן חזרה אחורה נוגעת רק לדמו:
- **הכי פשוט:** להריץ שוב את שלב 6.
- **אם הסקריפט נכשל עם `NON-demo row counts changed`:** זה לא אומר שמשהו נפגע, והדמו כבר נזרע מחדש. ההודעה מראה איזו טבלה השתנתה ואיך, למשל `invoices 340→341`. מספר שעלה אומר כמעט תמיד שמשתמש אמיתי עבד במערכת בזמן ההרצה. **לא משחזרים.** מריצים שוב את שלב 6 בזמן שאף אחד לא עובד, ובודקים ששלב 7 עובר.
- **משחזרים מקובץ הגיבוי של שלב 4 רק אם נתונים של מסעדה אחרת באמת נמחקו:** מספר ירד, ואף משתמש אמיתי לא עבד במערכת בזמן ההרצה.

**שחזור (רק אם משהו השתבש באמת).** מחזיר את כל הנתונים לרגע הגיבוי. אם החלון נסגר, מריצים קודם את שלב 3, ואז `export BACKUP=~/restomatch-backups/<שם הקובץ>.dump`.

```bash
pg_restore --list "$BACKUP" | grep -vE " SCHEMA - | COMMENT - SCHEMA " > ~/restomatch-backups/restore.list \
&& pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error \
  -L ~/restomatch-backups/restore.list -d "$DATABASE_URL" "$BACKUP" \
&& psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$(ls supabase/migrations/*_restomatch_rls_*.sql | sort | tail -1)" \
&& pnpm db:doctor
```

מה הבלוק עושה:
1. בונה רשימת שחזור בלי "DROP SCHEMA". את הסכמה עצמה לא מוחקים.
2. משחזר בטרנזקציה אחת. אם משהו נכשל, לא משתנה כלום.
3. מחזיר את הרשאות ה-RLS לתפקיד האפליקציה. זה חובה אחרי שחזור.
4. בודק: `db:doctor` צריך להחזיר 0 FAIL.

השחזור נבדק מקומית על עותק:
- גיבוי של 43 טבלאות.
- מחיקה מכוונת של מסעדה וחשבוניות.
- שחזור: חזרו 4 מסעדות, 339 חשבוניות, כל המשתמשים והמיגרציות.
- אחרי שלב 3 בבלוק: `db:doctor` מחזיר 0 FAIL.

## מה לעולם לא עושים

- לא מריצים בפרודקשן `pnpm --filter @restomatch/db seed` בלי `SEED_SCOPE=demo`. זה היה מוחק את **כל** המסעדות. הסקריפט מסרב לזה עכשיו בכל DB שאינו מקומי.
- לא מריצים `seed-demo` או `seed-chain-demo` לבד בפרודקשן. תמיד דרך `reseed:demo`, שבודק לפני ואחרי.
- לא מדביקים סיסמה או `DATABASE_URL` בצ'אט, בקובץ או בהודעה. סוגרים את חלון הטרמינל בסוף.
- לא משתמשים בכתובת של Vercel (`restomatch_app`, פורט 6543) לזריעה.

</div>

---

**Technical notes (English, for engineers):**
- **Scripts:** `apps/worker/scripts/reseed-demo.ts` and `check-demo.ts` (`pnpm --filter @restomatch/worker check:demo`, which reads `DATABASE_URL` and `DEMO_TODAY`).
- **Tenant selection and refusal rules:** `packages/db/src/demoTenants.ts`.
  - Main tenant: business id `514778123` + name.
  - Branches: exact name + the main tenant's billing account.
  - It refuses on any mix with real data: shared members, a shared billing account, or the business id reused under another name.
- **Connection:** the owner role through the session pooler, `postgres.<ref>@<pooler>:5432`. The password is URL-encoded in step 3 and never echoed.
- **Deletion:** one transaction. Cascading FKs remove everything under the tenants. The audit_log immutability trigger allows deletes by the table owner.
- **Proof that nothing else changed:** a per-table row-count fingerprint of all non-demo data, taken before and after.
- **Tests:** `packages/db/src/__tests__/demo-tenants.test.ts` and `seed-guard.test.ts`.
- **End-to-end run:** done on a local prod-like copy with a real tenant present.
  - The real tenant came out byte-identical.
  - The owner's test invoices and an invited demo user were removed.
  - A second run was idempotent.
