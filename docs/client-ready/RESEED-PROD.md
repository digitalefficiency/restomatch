# איפוס וזריעה מחדש של נתוני הדמו בפרודקשן

<div dir="rtl">

**למי:** הבעלים. רצים מהמק דרך ה-Session pooler של Supabase.
**מה זה עושה:**
- מוחק **רק** את מסעדות הדמו: "כפר הזיתים" והסניפים "כפר הזיתים — חיפה" ו"כפר הזיתים — ירושלים".
- כולל כל מה שהוספת אליהן בבדיקות: חשבוניות, כפילויות, קבלות סחורה, משתמשים שהוזמנו לדמו.
- זורע אותן מחדש ליום ההצגה.

**מה זה לא עושה:**
- לא נוגע באף מסעדה אחרת.
- הסקריפט סופר את השורות של כל השאר לפני ואחרי, ונכשל אם משהו השתנה.

> ⚠️ **לפני הכל: גיבוי.** ב-Supabase: Database → Backups. ודא שיש גיבוי מהיום, או הפעל Point-in-Time Recovery. בלי גיבוי — לא מריצים.

---

## 1. הכנה חד-פעמית במק

```bash
# Node 22 + pnpm 10.33.0
node -v            # v22.x
corepack enable && corepack prepare pnpm@10.33.0 --activate

git clone https://github.com/digitalefficiency/restomatch.git
cd restomatch
git checkout main && git pull
pnpm install --frozen-lockfile
```

## 2. כתובת החיבור (Session pooler)

ב-Supabase: **Connect** (למעלה) → **Session pooler** → העתק את ה-URI. הוא נראה כך:

```
postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

- `<PROJECT_REF>`: 20 התווים שבשם המשתמש, אחרי `postgres.`. זה מזהה הפרויקט.
- הפורט הוא **5432**, כלומר session pooler. לא 6543.
- סיסמת ה-DB: Project Settings → Database. אם יש בה תווים מיוחדים, צריך לקודד אותם (URL-encode).

## 3. משתנים לטרמינל

כל המשתנים מוגדרים רק בחלון הטרמינל הזה. לא שומרים אותם בקובץ.

```bash
export DATABASE_URL='postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres'
export SEED_ALLOW_REMOTE_HOST='aws-0-<region>.pooler.supabase.com'   # בדיוק ה-host מה-URI
export RESEED_PROJECT_REF='<PROJECT_REF>'                             # חייב להתאים ל-URI, אחרת הסקריפט מסרב
export DEMO_PASSWORD="$(openssl rand -base64 18)"; echo "$DEMO_PASSWORD"   # ← שמור במנהל הסיסמאות! זו סיסמת משתמשי הדמו
```

**למה שלושה מזהים?** ה-host של ה-pooler משותף לכל הפרויקטים באזור. הסקריפט רץ רק אם גם ה-host וגם ה-project ref תואמים. כך אי אפשר לזרוע בטעות לפרויקט אחר.

**`/admin` בדמו:** כברירת מחדל, משתמש הדמו `owner@` **לא** מקבל הרשאת מנהל פלטפורמה בפרודקשן. `/admin` מציג את כל המסעדות, כולל לקוחות אמיתיים. אם חייבים להציג את `/admin`, אפשר להוסיף `export DEMO_PLATFORM_ADMIN=1`. אחרי ההצגה מריצים שוב בלעדיו.

## 4. הרצת בדיקה (dry-run): לא משנה כלום

```bash
pnpm --filter @restomatch/worker reseed:demo -- --today 2026-10-25 --dry-run
```

מה אמור להופיע:
- `demo tenants found:` עם עד שלוש מסעדות. בהרצה ראשונה: `none (first seed)`.
- טבלה של כמה שורות יימחקו בכל טבלה. זה רק הדמו: invoices, goods_receipts, users של `@kfar-hazeitim.test` וכו'.
- `other tenants (left untouched): N restaurant(s)`: כמה מסעדות אמיתיות יישארו בלי שינוי.

**אם מופיע `refusing: the demo tenants are mixed with real data`**: עוצרים. ההודעה אומרת בדיוק מה מעורבב. למשל, משתמש אמיתי שהוזמן למסעדת הדמו. מוציאים אותו מהצוות של הדמו דרך המסך "צוות" ומריצים שוב.

## 5. ההרצה האמיתית

```bash
pnpm --filter @restomatch/worker reseed:demo -- --today 2026-10-25
```

- זה לוקח כ-2–4 דקות.
- בסוף אמור להופיע: `✔ done. Other tenants unchanged (...)` ושורת `hero`.
- **אם משהו נכשל באמצע:** שום דבר מחוץ לדמו לא נגע. מתקנים את הסיבה ומריצים **את אותה פקודה שוב**. הפעולה בטוחה להרצה חוזרת.

## 6. בדיקה אחרי ההרצה

```bash
pnpm db:doctor        # צריך: 0 FAIL
```

המספרים הצפויים ב-`--today 2026-10-25`, שנבדקו מקומית:

| מה | ערך |
|---|---|
| כפר הזיתים: דלף החודש | **₪760** מתוך ₪42,263 רכש לפני מע״מ (**1.8%**) |
| נתפס לפני תשלום / הוחזר מספקים | ₪296 / ₪464 |
| חשבוניות עם דליפה | 13 מתוך 37 |
| תור אישורים | 5 פתוחים, ו-2 חשבוניות ריכוז ממתינות לשיוך (רגוע, לא התראה) |
| קבלת סחורה היום (25/10) | **ירקות השרון 10:00** (11 שורות, פתוחה, להדגמה חיה), קצביית הכרם 12:30, מחלבות הגליל 15:00 |
| חודשים קודמים (להשוואות "חודש שעבר מול קודם") | יולי ₪1,107 מתוך ₪62,551 (1.77%) · אוגוסט ₪1,042 מתוך ₪62,028 (1.68%) · ספטמבר ₪1,059 מתוך ₪63,301 (1.67%) |
| סניף חיפה | ₪355 מתוך ₪61,740 (0.6%) |
| סניף ירושלים | ₪975 מתוך ₪33,056 (2.9%) |

ההתחברות: `owner@kfar-hazeitim.test` (וגם `manager@`, `receiver@` באנגלית, `bookkeeper@`, `chef@`), עם הסיסמה מ-`DEMO_PASSWORD`.

## 7. אם צריך לחזור אחורה

הסקריפט לא נוגע במסעדות אחרות, ולכן חזרה אחורה נוגעת רק לדמו:
- **הכי פשוט:** להריץ שוב את סעיף 5.
- **אם משהו אחר נפגע** (הסקריפט היה נכשל עם `NON-demo row counts changed`): לשחזר מהגיבוי שעשית בהתחלה (ראו האזהרה בראש המסמך) דרך Database → Backups → Restore. שחזור מחזיר את כל הפרויקט לנקודת הגיבוי.

## מה לעולם לא עושים

- לא מריצים בפרודקשן `pnpm --filter @restomatch/db seed` בלי `SEED_SCOPE=demo`. זה היה מוחק את **כל** המסעדות. הסקריפט מסרב לזה עכשיו בכל DB שאינו מקומי.
- לא מריצים `seed-demo` או `seed-chain-demo` לבד בפרודקשן. תמיד דרך `reseed:demo`, שבודק לפני ואחרי.
- לא משאירים את `DATABASE_URL` בקובץ או בהיסטוריה. סוגרים את חלון הטרמינל בסוף.

</div>

---

**Technical notes (English, for engineers):**
- **Script:** `apps/worker/scripts/reseed-demo.ts`.
- **Tenant selection and refusal rules:** `packages/db/src/demoTenants.ts`.
  - Main tenant: business id `514778123` + name.
  - Branches: exact name + the main tenant's billing account.
  - It refuses on any mix with real data: shared members, a shared billing account, or the business id reused under another name.
- **Deletion:** one transaction. Cascading FKs remove everything under the tenants. The audit_log immutability trigger allows deletes by the table owner (the migration role).
- **Proof that nothing else changed:** a per-table row-count fingerprint of all non-demo data, taken before and after.
- **Tests:** `packages/db/src/__tests__/demo-tenants.test.ts` and `seed-guard.test.ts`.
- **End-to-end run:** done on a local prod-like copy with a real tenant present.
  - The real tenant came out byte-identical.
  - The owner's test invoices and an invited demo user were removed.
  - A second run was idempotent.
