<div dir="rtl">

# הסרת Redis — מעבר ל-Postgres (Supabase) בלבד

**החלטת בעלים, 2026-10-24:** "drop redis change all to supabase".
מהגרסה הזו המערכת רצה על Postgres בלבד. אין יותר Upstash, ‏ioredis, ‏BullMQ או `REDIS_URL`.

## מה עבר לאן

| קודם (Redis) | עכשיו (Postgres, מיגרציה 0061) |
|---|---|
| תורי BullMQ ‏(OCR, התאמה, ייבוא קטלוג, מיילים, cron) | טבלת `job_queue`. ה-worker תופס משימה ב-`FOR UPDATE SKIP LOCKED`, כך ששני workers לעולם לא תופסים אותה משימה |
| Job schedulers ‏(06:00, 02:00, כל דקה…) | מתזמן בתוך ה-worker. כל "משבצת זמן" הופכת לשורה אחת בלבד (`dedupe_key` ייחודי), גם כששני workers רצים |
| ‏rate limit של התחברות, magic link ואיפוס סיסמה | טבלת `rate_limit_counters` (חלון קבוע, upsert אחד). אותן מגבלות בדיוק, אותו "fail open" אחרי 1.5 שניות |
| פעימת חיים של ה-worker (הבאנר בדשבורד + התראת מייל) | טבלת `worker_heartbeats`, ‏ודגל ההתראה ב-`ops_kv` |
| ‏Redis watchdog ו-`/health/ready` | ‏`select 1` מול מסד הנתונים |

הטבלאות נגישות רק לחיבור הבעלים (owner/service). ה-role של הדיירים (`restomatch_app`) לא קורא ולא כותב בהן אף שורה: בכל ארבע הטבלאות RLS פעיל. ב-`job_queue` דייר רואה רק את המשימות שלו, ובשלוש האחרות יש מדיניות "אין גישה".

## תזמונים (cron) — מה השתנה

- אותם 12 תזמונים, אותו אזור זמן (Asia/Jerusalem). הזמנים מחושבים עם cron-parser, אותה ספרייה ש-BullMQ השתמש בה, כולל מעבר שעון. מעבר השעון של 2026-10-25 נבדק בטסטים.
- **משבצת שפוספסה** (ה-Mac ישן או כבוי) רצה כשה-worker חוזר, בתוך חלון: עד 6 שעות למשימה יומית, ועד 3 ימים לדוח החודשי. משימות "כל X דקות" לא משלימות פספוסים, כי הבאה בתור מגיעה ממילא.
- **ביום המעבר:** בפעם הראשונה שכל תזמון רץ על Postgres, המשבצת האחרונה שכבר עברה **לא** מורצת שוב (BullMQ כבר הריץ אותה). היא נרשמת כ"דולגה", וכך אין דוחות כפולים למנהלים.
- משימה שה-worker שלה קרס חוזרת לתור פעם אחת בלי "לשרוף" ניסיון, כמו ב-BullMQ. אם היא מפילה את ה-worker פעם שנייה, היא מסומנת כנכשלה.

## משתני סביבה

| איפה | מה לעשות |
|---|---|
| **Vercel** (Production + Preview) | למחוק את `REDIS_URL` — **שבוע אחרי** שהכול עובד (הוא נדרש לגלגול לאחור). עד אז הוא לא בשימוש; האפליקציה רק רושמת אזהרה. לא צריך משתנה חדש: התור משתמש ב-`DATABASE_URL` הקיים |
| **`~/.restomatch/worker.env`** (ה-Mac) | למחוק את השורה `REDIS_URL=…`. גם אם תישאר, ‏`start-worker.sh` מתעלם ממנה ומדפיס הערה. ‏`DATABASE_URL` נשאר כמו שהוא (session pooler או חיבור ישיר) |
| **Fly / Render** (כשיעבור לענן) | לא להגדיר `REDIS_URL`; הוא הוסר מ-`render.yaml` ומהמדריך |
| אופציונלי | ‏`QUEUE_DATABASE_URL` — רק אם רוצים חיבור נפרד לתור. ברירת המחדל: `DATABASE_URL` |

## סדר הפעולות (≈15 דקות, עדיף בערב בלי העלאות פתוחות)

1. **לוודא שאין עבודה תלויה ב-Redis:** בדשבורד אין חשבוניות במצב "ממתין ל-OCR". משימות שנשארו ב-Redis לא עוברות לבד. ה-OCR sweep אמנם יכניס מחדש חשבונית שתקועה 10–25 דקות, אבל עדיף לא לסמוך על זה.
2. **מיזוג ה-PR.** ‏GitHub → ה-PR → Merge.
   - אינטגרציית Supabase–GitHub מריצה את מיגרציה 0061 (טבלאות חדשות בלבד, אין שינוי בנתונים קיימים).
   - ‏Vercel פורס את האתר החדש אוטומטית.
3. **בדיקת האתר:** `scripts/verify-prod.sh https://<האתר>` → כל השורות PASS. התחברות עובדת.
4. **עדכון ה-worker ב-Mac:**
   ```bash
   launchctl bootout gui/$(id -u)/com.restomatch.worker     # עצירה
   cd <תיקיית הריפו — הנתיב שהוחלף ב-__REPO__ ב-plist> && git pull && pnpm install --frozen-lockfile
   sed -i '' '/^REDIS_URL=/d' ~/.restomatch/worker.env        # אופציונלי
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.restomatch.worker.plist
   ```
5. **בדיקת ה-worker:**
   - `tail -f ~/Library/Logs/restomatch-worker.log` → `[worker] started 13 workers` ו-`[cron] registered: …`.
   - `curl -s localhost:8080/health/ready` → `{"status":"ready","db":"up"}`.
   - בדשבורד אין באנר "ה-worker לא פעיל" (תוך דקה).
   - העלאת חשבונית אחת בקבלת סחורה → מגיעה למסך הבדיקה.
6. **Upstash:** לא למחוק עדיין. אחרי שבוע בלי בעיות: למחוק את `REDIS_URL` מ-Vercel ואת מסד ה-Upstash.

בין שלב 2 לשלב 4 האתר כבר מכניס משימות ל-Postgres. הן מחכות שם (לא הולכות לאיבוד) עד שה-worker החדש עולה ומעבד אותן.

## גלגול לאחור (Rollback)

1. GitHub → ה-PR הממוזג → **Revert** → מיזוג. ‏Vercel פורס את הגרסה הקודמת, שמשתמשת שוב ב-`REDIS_URL`. לכן לא מוחקים אותו בשבוע הראשון.
2. ב-Mac:
   ```bash
   launchctl bootout gui/$(id -u)/com.restomatch.worker
   cd <תיקיית הריפו> && git checkout <ה-commit שלפני המיזוג> && pnpm install --frozen-lockfile
   # להחזיר REDIS_URL=… ל-~/.restomatch/worker.env אם נמחק
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.restomatch.worker.plist
   ```
3. הטבלאות של 0061 נשארות במסד. הן חדשות בלבד, אף קוד ישן לא נוגע בהן, ואין צורך במיגרציה הפוכה. משימות שנכנסו ל-`job_queue` אחרי הגלגול לא יעובדו; חשבוניות כאלה יופיעו במייל הבריאות היומי כ"ממתינות ל-OCR". אפשר להעלות אותן שוב.

## נקודה פתוחה (החלטת בעלים)

`packages/db/src/rls.ts` נותן ל-`restomatch_app` הרשאות על **כל** הטבלאות. הוא כלול ב-provision-rls ובמיגרציית ה-RLS של Supabase, שרצה מיד אחרי 0061, והוא ברשימת הקבצים הנעולים. לכן ה-REVOKE שב-0061 מתבטל בפועל.
- **זה כבר מכוסה:** RLS עם מדיניות "אין גישה" חוסם את הדייר גם כשיש לו הרשאה. גם אם הדייר נפרץ, הוא לא יכול לאפס מונה התחברות או לזייף פעימת worker.
- **הצעה (לא חובה), חיזוק נוסף:** שורה אחת ב-rls.ts — `revoke all on worker_heartbeats, rate_limit_counters, ops_kv, job_queue from restomatch_app;`. מחכה לאישור.

</div>
