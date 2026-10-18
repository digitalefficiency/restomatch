# תוכנית אבטחה — מסלול ל-Security Level 3 + ציות לחוק הגנת הפרטיות (תיקון 13)

> מסמך ביצוע (executable backlog). נגזר מ-AUDIT_FINDINGS + VERIFY_VERDICTS.
> כל פריט הוא PR בודד, בגודל סביר לסקירה. סדר עבודה מחייב — ראו "סדר תלויות וריצוף" בסוף.
>
> **מצב נוכחי (ground-truth):** מערכת חיה, רב-דיירת (multi-tenant), Hebrew/RTL. בידוד דיירים נשען על
> שתי שכבות — סינון `restaurant_id` בשכבת-האפליקציה (הבקרה הראשית) + Postgres RLS כ-defense-in-depth
> (drizzle/rls/0002). מצב הייצור שאומת חי: דלי האחסון `invoice-scans` הוא **PUBLIC** (אומת `public=true`),
> סריקות חשבוניות נקראות ב-`getPublicUrl`, ו-0001 (הפיכת הדלי לפרטי) **לא הוחל**. אימות הוא **magic-link בלבד**
> (אין סיסמה/2FA). אין HTTP security headers כלל. אין מדיניות פרטיות/תנאי שימוש/cookie-consent/DSR.
>
> **יעד:** Level 3 (ציות מלא) + חוק הגנת הפרטיות הישראלי כולל תיקון 13, וכן: סיסמה (argon2id) כאימות ראשי
> + magic-link גיבוי + "זכור אותי" + 2FA, ובידוד אחסון פר-מסעדה שמוקצה אוטומטית ביצירת מסעדה.

---

## ⛔ שער עצירה לאישור (STOP-FOR-APPROVAL GATE)

לפני **כל** PR שמסומן 🔒 — כלומר כל שינוי שנוגע ב:
1. **נתיב האימות החי** (auth.ts / auth.config.ts / middleware / login / סשנים / credentials / 2FA), או
2. **מדיניות RLS / role provisioning / storage RLS** (כל קובץ תחת `packages/db/drizzle/rls/`, `packages/db/src/rls.ts`,
   או הפיכת חיבור ה-tenant ל-fail-closed),

**יש לעצור ולקבל אישור מפורש לפני merge ולפני apply בייצור.** הסיבה: ל-RLS וה-provisioning יש Cutover ידני
שלא עובר `pnpm db:migrate` (0002 header:3, DEPLOY_CUTOVER.md:80-89). טעות אחת = או חשיפה חוצת-דיירים
או נעילת המערכת מבחוץ (login outage). כל PR כזה חייב: (א) dry-run מול staging/branch, (ב) feature-flag או
rollback אטומי מתועד, (ג) אישור אנושי לפני הפעלה בפרודקשן.

PRs המסומנים 🔒: 0.3, 0.4, A.1, A.2, A.3, A.4, A.7, B.1, B.2, B.3, B.4, B.5, B.6, C.1, C.2.

---

## מפת אפיקים (Epics)

| Epic | נושא | # פריטים | סיכון מצרפי |
|------|------|----------|-------------|
| **0** | תשתית אכיפת RLS וחיבורי DB (fail-closed) | 6 | בינוני |
| **A** | בידוד אחסון סריקות-חשבוניות פר-מסעדה + provisioning + attack-test | 8 | גבוה |
| **D1** | בקרות Web: headers / CSP / cookies / CSRF / rate-limit / OCR | 7 | בינוני |
| **D2** | סודות, הצפנה-at-rest, audit-log, logging/monitoring, backups | 5 | גבוה |
| **D3** | Supply-chain: CI gates (audit/SAST/secret-scan/Dependabot) + xlsx + argon2 dep | 7 | בינוני |
| **B** | סיסמה (argon2id) כאימות ראשי + reset + remember-me 🔒 | 6 | גבוה |
| **C** | 2FA (TOTP) + account lockout + session-revocation 🔒 | 2 | גבוה |
| **E** | משפטי/פרטיות: privacy/terms/cookies/DPA/DSR/retention/breach | 9 | בינוני |
| **F** | נכסי שיווק Higgsfield (אופציונלי) | 1 | נמוך |

**סה"כ פריטי עבודה: 51.**

---

# Epic 0 — תשתית אכיפת RLS וחיבורי DB

> בסיס לכל השאר. זול, אך נוגע ב-provisioning/RLS — לכן 0.3/0.4 הם 🔒.
> הערת verdict: ההשפעה "RLS אילם בשקט אם DATABASE_URL_APP לא מוגדר" **הופרכה לפרודקשן** —
> `assertWebEnv` כבר זורק כשל boot רועש כשהמשתנה ריק (env.ts:46,52-54). הפער האמיתי שנותר:
> `DATABASE_URL_APP` שמוגדר אך מצביע על role שעוקף RLS — זה לא נתפס בריצה (assertAppRoleNoBypass הוא dead code).

### 0.1 — חיווט boot-guard ל-assertAppRoleNoBypass
- **מטרה:** להפוך `DATABASE_URL_APP` שמכוון ל-owner/service_role (עוקף RLS) לכשל boot רועש במקום RLS אילם בשקט.
- **קבצים:** `apps/web/instrumentation.ts` (קריאה ל-`assertAppRoleNoBypass(db)` מיד אחרי `assertWebEnv()` ב-Node runtime), `apps/web/lib/env.ts:66-77` (כבר מוגדר — להסיר את ה-dead-code), `apps/web/lib/db.ts`.
- **גישה:** ב-`register()` קרא ל-`assertAppRoleNoBypass(db)`; אם `rolbypassrls=true` — `process.exit`/throw. אופציונלי: ודא ש-`app.current_restaurant_id()` מחזיר NULL ללא GUC.
- **בדיקות קבלה:** unit — הפונקציה זורקת על חיבור owner-role ועוברת על `restomatch_app`; boot-test ש-`register()` קורא לה.
- **Rollback:** revert לקריאה ב-instrumentation. additive בלבד.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 access-control enforcement (defense-in-depth verification).

### 0.2 — Fail-closed כשה-role הלא-owner לא מוגדר
- **מטרה:** לעולם לא להגיש תעבורת tenant על חיבור owner.
- **קבצים:** `apps/web/lib/db.ts:12` (להסיר `DATABASE_URL_APP ?? DATABASE_URL` בכל סביבה שאינה test, או להשאיר fallback רק תחת `ALLOW_OWNER_DB=1`), `apps/web/lib/env.ts:44-55` (לדרוש `DATABASE_URL_APP` בכל `NODE_ENV!=='test'`, לא רק `==='production'`).
- **גישה:** הערת context.ts:18-19 — כיום ה-web רץ כ-owner בכוונה עד Phase-2; ה-PR הזה הוא חלק מ-cutover ל-Phase-2 ולכן יש לתאם עם 0.3.
- **בדיקות קבלה:** env-test — `DATABASE_URL_APP` חסר מחוץ ל-test ⇒ throw; קיים אך owner-role ⇒ נתפס ע"י 0.1.
- **Rollback:** החזרת ה-`?? DATABASE_URL`.
- **סיכון:** בינוני. **תלויות:** 0.1.
- **בקרה/חובה:** Level-3 — least-privilege DB connection.

### 0.3 🔒 — אוטומציה ואימות של RLS + provisioning של restomatch_app
- **מטרה:** להפוך הפעלת RLS וה-grants/revokes של ה-app-role ל-artifact אידמפוטנטי, נסקר, מוחל אוטומטית, ומאומת בריצה — במקום צעד psql ידני.
- **קבצים:** `packages/db/src/rls.ts`, `packages/db/drizzle/rls/0002_core_tenant_rls.sql`, `packages/db/scripts/` (provision script חדש), `apps/web/lib/env.ts` (startup assertion ש-relrowsecurity=true לכל טבלה עם `restaurant_id`), `docs/DEPLOY_CUTOVER.md`, `.github/workflows/` (gate ל-completeness query).
- **גישה:** provisioning idempotent שיוצר `restomatch_app`, מחיל 0001+0002, מריץ grants/revokes; startup assertion שמשתמש ב-completeness query (0002:205-218) ומבטל boot אם טבלה כלשהי עם `restaurant_id` חסרה rowsecurity/policy; CI gate שמכשיל merge אם נוספה טבלת-דייר ללא policy.
- **בדיקות קבלה:** migration test מול DB טרי — כל טבלה עם `restaurant_id` מסתיימת עם RLS on; CI completeness query מחזיר ריק; הוספת טבלת `restaurant_id` ללא policy מכשילה CI.
- **Rollback:** provisioning אידמפוטנטי; ניתן לכבות את ה-startup assertion ב-flag אם חוסם deploy תקין ידוע.
- **סיכון:** גבוה. **תלויות:** —.
- **בקרה/חובה:** Level-3 — tenant isolation enforced + drift prevention; תיקון 13 — accountability/documentation.

### 0.4 🔒 — Audit-log כ-append-only (immutable) + role ייעודי
- **מטרה:** audit trail בלתי-ניתן-לשינוי, tamper-evident (תיקון 13 / Level-3 audit integrity).
- **קבצים:** `packages/db/src/rls.ts` (REVOKE update,delete על `audit_log` מ-`restomatch_app`, שמירת select/insert), `packages/db/drizzle/rls/0003_audit_immutable.sql` (חדש — BEFORE UPDATE/DELETE trigger שזורק + INSERT-only RLS policy).
- **גישה:** כיום ensureRlsAppRole נותן blanket CRUD ומדלג על revoke ל-audit_log (rls.ts:53,63-77) — דייר נפרץ יכול למחוק את ה-audit שלו. לסגור.
- **בדיקות קבלה:** RLS attack test — UPDATE/DELETE על audit_log ע"י app-role נדחה; INSERT+SELECT תחת ה-GUC עדיין עובדים.
- **Rollback:** drop trigger; restore grants.
- **סיכון:** נמוך. **תלויות:** 0.3.
- **בקרה/חובה:** Level-3 audit-log integrity; תיקון 13 — תקנות אבטחת מידע 2017.

### 0.5 — אכיפת same-tenant ל-products.supplier_id ב-DB
- **מטרה:** למנוע הפניית product לספק של דייר אחר.
- **קבצים:** `packages/db/src/schema.ts` (~393-400, אזהרה קיימת), `packages/db/drizzle/` (migration חדש).
- **גישה:** composite FK על `(supplier_id, restaurant_id)` ⇒ `suppliers(id, restaurant_id)`, או CHECK/trigger; תיקון offenders קודם (backfill/repair).
- **בדיקות קבלה:** insert/update של product עם supplier_id של דייר זר נדחה.
- **Rollback:** drop constraint.
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — referential tenant integrity.

### 0.6 — הרחבת RLS attack-suite לכל 21 הטבלאות
- **מטרה:** להוכיח ישירות דחייה חוצת-דיירים לכל הטבלאות עם `restaurant_id`.
- **קבצים:** `packages/api/src/__tests__/rls.attack.test.ts` (PARENT_PROBES:173-206 חסר 7 טבלאות), `packages/api/src/__tests__/fixtures.*`.
- **גישה:** הוסף probes ל-`price_history, price_baselines, approval_rules, procurement_connections, email_inboxes, supplier_integrations, notifications_outbox` עם seed לשני דיירים.
- **בדיקות קבלה:** `it.each` — GUC=A רואה רק שורות דייר-A לכל טבלה.
- **Rollback:** הסרת probes.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — verified isolation coverage.

---

# Epic A — בידוד אחסון סריקות-חשבוניות פר-מסעדה

> **הממצא הקריטי שאומת חי:** הדלי `invoice-scans` הוא PUBLIC (`public=true`), 0001 לא הוחל, ו-`getPublicUrl`
> בשימוש בנתיבי upload/OCR/showcase. כל URL שדלף = קריאה לא-מאומתת של מסמך פיננסי עם PII.
> מנגד (מיטיגציה קיימת): נתיב הצפייה הקנוני `/scans/[invoiceId]` כבר מאובטח — session + `.eq(restaurant_id)` + signed URL ל-30 דק' (server.ts:47-66). לכן הפער הוא בעיקר ב-upload-trust וב-storage-layer authz.

### A.1 🔒 — הפיכת הדלי לפרטי + הגשת כל הקריאות ב-signed URLs
- **מטרה:** לחסל סריקות world-readable; להסיר כל הסתמכות על public object URLs.
- **קבצים:** `packages/db/drizzle/rls/0001_invoice_scans_rls.sql` (להחיל `public=false`, שורה 8), `packages/db/src/rls.ts` (להוסיף `applyStorageRls` במקביל ל-`applyCoreTenantRls` — כיום rls.ts:24-27 מדלג על 0001), `apps/web/lib/supabase/client.ts:95-119` (להסיר `getPublicUrl`), `apps/web/app/api/showcase/ocr/route.ts:96-98` (לצרוך signed URL מהשרת או לקרוא bytes server-side במקום prefix `/object/public/`).
- **גישה:** ב-OCR — להעביר `fetchBytes=true` למסלול Anthropic (claudeVision.ts:36-44) כי דלי פרטי אינו ניתן ל-fetch ע"י Anthropic ישירות. אמת `public=false` דרך get_advisors/storage.
- **בדיקות קבלה:** fetch של `/object/public/invoice-scans/...` מחזיר 400/403; `resolveUploadedScan` עדיין מגיש את אותו קובץ דרך signed URL.
- **Rollback:** SQL יחיד `public=true` + restore getPublicUrl. ללא שינוי schema.
- **סיכון:** בינוני. **תלויות:** 0.3.
- **בקרה/חובה:** Level-3 confidentiality at storage layer; תיקון 13 — PII confidentiality.

### A.2 🔒 — storage.objects RLS פר-מסעדה לפי path-prefix
- **מטרה:** defense-in-depth — שכבת האחסון אוכפת בידוד, לא רק סינון האפליקציה.
- **קבצים:** `packages/db/drizzle/rls/0001_invoice_scans_rls.sql:14-24` (להחליף policies bucket-wide), `packages/db/src/rls.ts` (applier).
- **גישה:** policies שדורשים `(storage.foldername(name))[1] = app.current_restaurant_id()::text` (או EXISTS על membership) ל-SELECT/INSERT/UPDATE/DELETE; policy צר נפרד ל-prefix האנונימי `walk-ins/` של showcase. קריאות service-role (server.ts) ממשיכות לעקוף RLS בכוונה — סינון האפליקציה נשאר ה-gate שם.
- **בדיקות קבלה:** חיבור עם GUC של דייר-B לא יכול SELECT אובייקט תחת prefix של דייר-A; יכול את שלו.
- **Rollback:** drop prefix policies, fallback ל-bucket-wide authenticated.
- **סיכון:** בינוני. **תלויות:** A.1.
- **בקרה/חובה:** Level-3 — storage tenant isolation.

### A.3 🔒 — העברת ה-upload לשרת עם אכיפת membership (להפסיק לסמוך על client)
- **מטרה:** ה-prefix וה-`restaurant_id` שנכתב ב-mapping נגזרים מה-session המאומת, לא מהדפדפן.
- **קבצים:** `packages/api/src/routers/` (mutation חדש `scans.upload` / memberProcedure), `apps/web/lib/supabase/client.ts:78-119` (להפוך ל-thin caller), `apps/web/app/dashboard/receiving/[poId]/wizard.tsx:267-271` (להסיר restaurantId/storagePrefix כ-trust input), `apps/web/app/showcase/receiver/_steps/InvoiceScan.tsx`.
- **גישה:** memberProcedure (כבר אוכף GUC דרך withRestaurant) מקבל קובץ, גוזר path `<session.restaurantId>/<id>`, מעלה ב-service-role, מכניס שורת invoice_scans בשרת. showcase אנונימי נשאר constrained ל-`walk-ins/` בלבד. **verdict:** כיום ה-upload כולו client-side עם anon key, ה-restaurant_id ו-path נשלטי-לקוח (client.ts:103-113) — אין שום בדיקת שרת ש-caller שייך ל-`opts.restaurantId`.
- **בדיקות קבלה:** mutation דוחה כשה-caller אינו member של היעד; שרת מתעלם מ-restaurant_id ששלח הלקוח וחותם את של ה-session.
- **Rollback:** הפעלת נתיב upload client-side מאחורי flag.
- **סיכון:** גבוה. **תלויות:** A.1.
- **בקרה/חובה:** Level-3 — write-side tenant authority; תיקון 13 — data integrity.

### A.4 🔒 — Auto-provisioning של מרחב אחסון פר-מסעדה ב-onboarding.createRestaurant
- **מטרה:** כל מסעדה מקבלת מרחב אחסון מבודד ואכוף בזמן יצירה (הדרישה המפורשת של היעד).
- **קבצים:** `packages/api/src/routers/onboarding.ts:50-80`, `packages/db/src/schema.ts` (טבלת `storage_namespaces` אופציונלית), `packages/db/drizzle/` (migration).
- **גישה:** בתוך ה-tx של createRestaurant — לרשום/לשמור את ה-prefix `<restaurantId>/` (שורת storage_namespaces או keep-marker 0-byte) כדי שה-namespace יהיה מפורש ו-quota-trackable; ה-prefix-scoped RLS מ-A.2 חל אוטומטית.
- **בדיקות קבלה:** אחרי createRestaurant ה-prefix שמור; דייר שני לא יכול לכתוב/לקרוא תחתיו; onboarding.test.ts מורחב.
- **Rollback:** דילוג על שלב ה-provisioning; prefix עדיין נגזר בזמן upload.
- **סיכון:** בינוני. **תלויות:** A.2.
- **בקרה/חובה:** Level-3 — auto-provisioned isolation (יעד מפורש).

### A.5 — Storage cross-tenant attack-test (storage.attack.test.ts)
- **מטרה:** להוכיח ב-CI שדייר אחד לא מגיע לסריקות של אחר באף וקטור.
- **קבצים:** `packages/api/src/__tests__/storage.attack.test.ts` (חדש), `packages/db/src/rls.ts` (export ל-storage-RLS applier).
- **גישה:** mirror ל-harness של rls.attack.test.ts. אסר: (1) A מעלה סריקה; (2) resolveUploadedScan של B מחזיר null ל-invoiceId של A; (3) public URL גולמי של A לא קריא; (4) GUC=B לא יכול SELECT שורת objects של A ולא INSERT עם restaurant_id של A; (5) B לא יכול לחתום signed URL ל-path של A; כולל guessed-path probe.
- **בדיקות קבלה:** זוהי הבדיקה; gate ב-CI לצד rls.attack.test.ts.
- **Rollback:** הסרת הקובץ.
- **סיכון:** נמוך. **תלויות:** A.3.
- **בקרה/חובה:** Level-3 — verified storage isolation.

### A.6 — הקטנת TTL של signed-URL + proxy להורדות
- **מטרה:** לצמצם חלון bearer-token ולמנוע דליפה דרך referrer/history/sharing.
- **קבצים:** `apps/web/lib/supabase/server.ts:38` (`SIGNED_URL_TTL_SEC` ל-כמה דקות), `apps/web/app/scans/[invoiceId]/page.tsx:141-156` (להגיש דרך route streaming מאומת במקום anchor "open in new tab"; להוסיף `rel=noreferrer`/Referrer-Policy), `apps/web/app/scans/` (stream route אופציונלי).
- **בדיקות קבלה:** signed URL פג ב-TTL החדש; ה-proxy מחזיר 404 לבקשה חוצת-דייר/לא-מאומתת.
- **Rollback:** החזרת 30 דק' + embedding ישיר.
- **סיכון:** נמוך. **תלויות:** A.1.
- **בקרה/חובה:** Level-3 — minimize bearer-token exposure.

### A.7 🔒 — Backfill ואיסור restaurant_id=null ב-invoice_scans
- **מטרה:** להסיר מחלקת הסריקות הלא-משויכות (null-tenant).
- **קבצים:** `packages/db/src/schema.ts:720-735` (column ל-NOT NULL), `packages/db/drizzle/` (migration), `packages/db/src/__tests__/invoice-scans.test.ts:29-32` (עדכון parity test), `apps/web/lib/supabase/client.ts` (דחיית upload ללא restaurantId מ-session).
- **גישה:** backfill לשורות קיימות; דחיית upload בלי restaurantId מ-session (production path) כדי שלא ייווצרו null-objects חדשים (verdict: dashboard upload עלול ליצור null-scan אם session hydration במרוץ).
- **בדיקות קבלה:** insert עם null נדחה; resolveUploadedScan ללא שינוי לשורות תקפות.
- **Rollback:** החזרת nullable.
- **סיכון:** בינוני. **תלויות:** A.3.
- **בקרה/חובה:** Level-3 — eliminate unscoped data.

### A.8 — צמצום registerInvoice imageUrl + worker fetch allowlist (SSRF)
- **מטרה:** לחסל SSRF/fetch-proxy מאומת דרך OCR.
- **קבצים:** `packages/api/src/routers/receiving.ts:530` (לאמת ש-imageUrl תחת prefix של invoice-scans, כמו showcase route), `apps/worker/src/jobs/ocrInvoice.ts`, `packages/ocr/src/providers/claudeVision.ts`.
- **גישה:** ב-worker — fetch bytes דרך service client של האובייקט של הדייר עצמו, במקום למסור URL שרירותי ל-Anthropic. **verdict:** registerInvoice מקבל `z.string().url().max(2048)` שרירותי ⇒ member יכול לגרום ל-worker/Anthropic לאחזר URL פנימי.
- **בדיקות קבלה:** registerInvoice דוחה URL שאינו invoice-scans; worker מאחזר רק את האובייקט של הדייר.
- **Rollback:** re-allow URL שרירותי מאחורי flag.
- **סיכון:** בינוני. **תלויות:** A.4.
- **בקרה/חובה:** Level-3 — SSRF prevention.

---

# Epic D1 — בקרות Web (headers / CSP / cookies / CSRF / rate-limit / OCR)

> **verdict חשוב:** היעדר security headers הוא עובדה מאומתת, אך ה-impact הוחלש (high→medium):
> cookie ברירת-המחדל של Auth.js v5 הוא HttpOnly+Secure+SameSite=Lax (אין override), מה שמקהה
> clickjacking-session-theft ו-TLS-strip. הפערים האמיתיים: היעדר CSP (אין שכבה שנייה נגד XSS/supply-chain)
> והיעדר HSTS (first-request downgrade). עדיין נדרש לעמידה ב-Level-3.

### D1.1 — Baseline של security headers
- **מטרה:** לשגר על כל תגובה: HSTS (`max-age>=15552000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` least-privilege, `poweredByHeader:false`.
- **קבצים:** `apps/web/next.config.ts:1-23` (`async headers()` + `poweredByHeader:false`), אופציונלי `apps/web/middleware.ts`.
- **גישה:** CSP בנפרד (ראו D1.2) כי דורש nonce per-request.
- **בדיקות קבלה:** e2e ש-GET `/` ו-`/dashboard` נושאים כל header עם הערך הצפוי; snapshot של פלט headers().
- **Rollback:** הסרת headers() block.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — transport/clickjacking hardening; תיקון 13.

### D1.2 — CSP מבוסס-nonce קפדני דרך middleware
- **מטרה:** לחסום inline/eval script ולהגביל connect/img/style למקורות ידועים, תואם Next streaming + Auth.js.
- **קבצים:** `apps/web/middleware.ts` (nonce per-request), `apps/web/app/layout.tsx` (חיווט nonce ל-next/script), `apps/web/next.config.ts`.
- **גישה:** `script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`. **Rollout ב-Report-Only תחילה** ואז enforce.
- **בדיקות קבלה:** e2e — inline `<script>` מוזרק לא רץ; ה-header נוכח עם nonce טרי לכל בקשה.
- **Rollback:** חזרה ל-Report-Only או הסרת ה-header.
- **סיכון:** בינוני. **תלויות:** D1.1.
- **בקרה/חובה:** Level-3 — XSS defense-in-depth.

### D1.3 — Pinning מפורש של Auth.js cookies (הכנה ל-remember-me + 2FA)
- **מטרה:** להפוך Secure/HttpOnly/SameSite + prefix `__Host-`/`__Secure-` למפורשים בקוד, לא תלויי auto-detection.
- **קבצים:** `apps/web/auth.ts:91-105` (cookies{} block — sessionToken/csrfToken/callbackUrl, `secure:true` בפרודקשן, httpOnly, sameSite:lax, `__Host-` היכן שאפשר), `apps/web/auth.config.ts`.
- **גישה:** scaffolding ל-remember-me (toggle בין maxAge קצר/ארוך); `useSecureCookies` מפורש בפרודקשן.
- **בדיקות קבלה:** integration test ל-Set-Cookie flags בקונפיג production-like; בחירת maxAge ל-remember-me.
- **Rollback:** הסרת cookies{} block.
- **סיכון:** בינוני. **תלויות:** —. (הערה: נוגע ב-auth.ts אך לא משנה התנהגות login — לא 🔒, אך לתאם עם Epic B.)
- **בקרה/חובה:** Level-3 — cookie hardening.

### D1.4 — JSON 401/403 ל-API auth failures + הפסקת חסימת public tRPC
- **מטרה:** publicProcedures (`leads.create`, `plans.list`) נגישים אנונימית; כשלי API מוחזרים כ-JSON ולא redirect ל-HTML.
- **קבצים:** `apps/web/middleware.ts:19-37,56-58`.
- **גישה:** special-case `path.startsWith('/api')` — להחזיר 401 JSON (לא redirect ל-/login) כשלא-מאומת, ולתת ל-tRPC publicProcedure/authedProcedure לאכוף. **verdict:** כיום `/api/trpc/*` ב-matcher אך לא ב-isPublic ⇒ POST אנונימי ל-leads.create מקבל 307 ל-/login ושובר את טופס הלידים השיווקי.
- **בדיקות קבלה:** POST אנונימי ל-leads.create ⇒ 200 + insert; POST ל-authed procedure ⇒ 401 JSON; טופס LeadForm עובד מנותק.
- **Rollback:** revert middleware.
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — correct API auth boundary.

### D1.5 — Throttle + הקשחת endpoint ה-OCR הציבורי
- **מטרה:** לעצור cost-amplification/DoS וכתיבות DB לא-מהימנות ב-`/api/showcase/ocr`.
- **קבצים:** `apps/web/app/api/showcase/ocr/route.ts`, `apps/web/lib/rateLimit.ts`, `packages/db/src/schema.ts` (מידול supplier_contacts עם restaurant_id+RLS אם נשאר).
- **גישה:** rate-limit per-IP + בדיקת Origin; caps על Content-Length; להעביר את כתיבת `reconcileContacts` למאחורי auth/tenant scope ולהריץ על app-role במקום `postgres(DATABASE_URL)` (owner); להחזיר שגיאה גנרית ולא `err.message`; gate ל-non-prod. **verdict (high, confirmed):** endpoint לא-מאומת, לא-מוגבל, מריץ Claude Opus Vision (maxDuration 60) וכותב supplier_contacts לפי business_id משליטת-המודל על חיבור owner.
- **בדיקות קבלה:** בקשה ה-11 בחלון ⇒ 429; cross-origin POST נדחה; אנונימי לא כותב supplier_contacts; אין דליפת err.message.
- **Rollback:** revert; feature-flag off.
- **סיכון:** בינוני. **תלויות:** D1.6 (limiter helper).
- **בקרה/חובה:** Level-3 — abuse/DoS + untrusted-write prevention.

### D1.6 — הרחבת כיסוי rate-limit + הקשחת ייחוס client-IP
- **מטרה:** הגנת brute-force/abuse על אימות ומוטציות רגישות, וייחוס IP אמין.
- **קבצים:** `apps/web/app/api/trpc/[trpc]/route.ts`, `packages/api/src/edge.ts:22-28`, `apps/web/lib/rateLimit.ts`.
- **גישה:** limiter גנרי per-IP+per-procedure ל-mutations רגישות/לא-מאומתות (invite accept, login עתידי, admin); לגזור IP מ-trusted-proxy hop (לא ה-XFF הראשון, שניתן לזיוף); להחליט מפורשות fail-open/closed per-limiter (login צריך fail-closed-ish). **verdict:** שני ה-limiters fail-open; magic-link send הוא email-bombing vector (low) — לא ATO כי אין credential login עדיין.
- **בדיקות קבלה:** unit ל-trusted-hop עם XFF מזויף; integration ש-login/invite חוזרים-ונשנים נחנקים.
- **Rollback:** revert edge.ts/route.ts.
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — brute-force/abuse resistance.

### D1.7 — אימות callbackUrl כ-relative-only
- **מטרה:** לחסל open-redirect ללא תלות ב-Auth.js internals.
- **קבצים:** `apps/web/app/login/page.tsx:10,21`, `apps/web/lib/safeRedirect.ts` (helper חדש).
- **גישה:** לדחות `//host`, `http(s)://`, וריאנטים עם backslash; default `/dashboard`.
- **בדיקות קבלה:** unit — `//evil.com`, `https://evil.com`, `/\evil.com` נדחים; `/dashboard/settings` מתקבל.
- **Rollback:** הסרת קריאת ה-helper.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — open-redirect prevention.

---

# Epic D2 — סודות, הצפנה-at-rest, audit-logging, monitoring, backups

### D2.1 — הצפנת שדות רגישים at-rest
- **מטרה:** להצפין identity tokens, magic-link tokens, integration creds, ו-PII בסיכון גבוה.
- **קבצים:** `packages/db/src/crypto.ts` (חדש — AES-256-GCM envelope עם data-key מ-KMS/env, או pgsodium/pgcrypto), `packages/db/src/schema.ts`, `apps/web/auth.ts` (adapter codec), `packages/db/drizzle/00xx_encrypt_sensitive.sql`.
- **גישה:** להצפין `accounts.access_token/refresh_token/id_token` (schema.ts:197-203), `verification_tokens.token` (216-224), `*_vault_ref` payloads; להעריך `users.email/phone` עם blind index ל-searchability. **dual-read** (plaintext+ciphertext) בחלון המעבר.
- **בדיקות קבלה:** round-trip encrypt/decrypt; backfill test; אימות ciphertext-at-rest דרך raw SQL.
- **Rollback:** dual-read; revert codec לקריאת plaintext.
- **סיכון:** גבוה. **תלויות:** —.
- **בקרה/חובה:** Level-3 — encryption at rest; תיקון 13 — sensitive-data protection.

### D2.2 — Audit-logging מקיף לפעולות רגישות
- **מטרה:** לתעד מי עשה/ניגש למה לכל אירוע אבטחה/PII.
- **קבצים:** `packages/api/src/audit.ts` (חדש — `recordAudit()`), `apps/web/auth.ts` (login, magic-link issuance, session switch), `packages/api/src/routers/team.ts` (role changes/invites), `packages/api/src/routers/*` (export paths), `apps/web/lib/supabase/server.ts` (invoice-scan access).
- **גישה:** taxonomy אחיד action/entity; כתיבה דרך הנתיב ה-immutable (0.4). **verdict:** כיום audit_log רק admin+approvals — אין login/issuance/role-change/export/scan-access; תיקון 13 דורש access logging.
- **בדיקות קבלה:** כל פעולה מנוטרת ⇒ שורת audit אחת עם actor+entity; export/scan-access מייצרים access records.
- **Rollback:** feature-flag ל-helper; ללא שינוי schema מעבר ל-audit_log.
- **סיכון:** בינוני. **תלויות:** 0.4.
- **בקרה/חובה:** Level-3 + תיקון 13 — access logging.

### D2.3 — Structured logging עם redaction + error capture/alerting אמיתי
- **מטרה:** אין secrets/PII בלוגים; נראות שגיאות והתראות בפרודקשן.
- **קבצים:** `packages/observability/src/logger.ts` (חדש — pino עם redact path-list: authorization, *token*, *secret*, password, connectionString, email/phone), `packages/observability/src/sentry.ts` (beforeSend PII scrub), call-sites של `console.*` ב-web+worker (17 קבצים), `apps/worker/src/health.ts`.
- **גישה:** התקנת `@sentry/nextjs`+`@sentry/node`, alerting (Sentry + uptime על /api/healthz ו-worker health); lint rule נגד raw console.
- **בדיקות קבלה:** redaction unit (אובייקט עם secret ממוסך); beforeSend מסיר email/token; lint חוסם console.
- **Rollback:** logger עוטף console; swap export.
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — logging/monitoring; תיקון 13 — sub-processor (Sentry) PII safety.

### D2.4 — Secret-rotation runbook + צמצום blast-radius של owner-connection ב-web
- **מטרה:** סודות ניתנים-לרוטציה + חיבור identity least-privilege ל-web.
- **קבצים:** `docs/ENV-PRODUCTION.md` (rotation runbook), `packages/db/src/rls.ts` (role חדש `restomatch_auth` scoped ל-identity tables), `apps/web/lib/authDb.ts` (להצביע ל-restomatch_auth), `apps/web/auth.ts` (AUTH_SECRET key-list), הסרת `.env.deploy.local` מהדיסק לתוך secret manager.
- **גישה:** **verdict (medium):** `.env.deploy.local` מכיל owner DATABASE_URL + service-role + AUTH_SECRET בcleartext (gitignored, לא בהיסטוריה — לכן לא critical). תמיכת AUTH_SECRET array לרוטציה ללא פסילת כל ה-JWTs.
- **בדיקות קבלה:** boot-test ש-authDb role לא קורא tenant tables; JWT מאומת תחת old+new AUTH_SECRET בחלון רוטציה.
- **Rollback:** repoint authDb ל-DATABASE_URL; single-key AUTH_SECRET.
- **סיכון:** בינוני. **תלויות:** 0.3.
- **בקרה/חובה:** Level-3 — secret rotation + least privilege.

### D2.5 — Backup posture: PITR, encryption, restore drills
- **מטרה:** גיבויים אוטומטיים, מוצפנים, מתועדים, עם recovery נבדק.
- **קבצים:** `docs/BACKUP_DR.md` (חדש), `docs/ENV-PRODUCTION.md`.
- **גישה:** הפעלת Supabase PITR, תיעוד RTO/RPO, גיבויים מוצפנים + access-controlled, restore drills תקופתיים.
- **בדיקות קבלה:** restore-drill checklist מול staging branch; אימות חלון PITR + הצפנה.
- **Rollback:** תיעוד/קונפיג בלבד.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — backups/DR; תיקון 13 — availability.

---

# Epic D3 — Supply-chain (CI security gates) + xlsx + argon2 dep

### D3.1 — pnpm audit CI gate
- **מטרה:** להכשיל CI על advisories high/critical ב-prod deps.
- **קבצים:** `.github/workflows/ci.yml`, `package.json` (`pnpm.auditConfig`).
- **גישה:** `pnpm audit --prod --audit-level=high` ב-PR + schedule שבועי; ל-advisory ללא fix (xlsx) — חריג time-boxed עם issue, לא suppression גורף.
- **בדיקות קבלה:** CI נכשל על high לא-מוחרג; עובר על tree נקי; רשימת חריגים מתוארכת.
- **Rollback:** הסרת step.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — dependency CI gate.

### D3.2 — חיסול xlsx@0.18.5 הפגיע מנתיב ה-upload הלא-מהימן
- **מטרה:** להסיר prototype-pollution (CVE-2023-30533) + ReDoS (CVE-2024-22363) בפענוח קטלוגים.
- **קבצים:** `packages/api/package.json` (להחליף xlsx), `packages/api/src/catalog/parse.ts:44-69`, `packages/api/src/__tests__/catalog-parse.test.ts`.
- **גישה:** parser מתוחזק/מטולא (exceljs / SheetJS 0.20.x integrity-pinned); guard byte-size/sheet **לפני** parse (כיום MAX_ROWS אחרי parse, catalog.ts:186); הרצה ב-worker לקבצים גדולים.
- **בדיקות קבלה:** XLSX זדוני לא משנה Object.prototype; sheet ReDoS-shaped נדחה בזמן חסום; בדיקות Hebrew-header עדיין עוברות.
- **Rollback:** revert ל-xlsx@0.18.5 (מחזיר advisory).
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — vulnerable-dep on untrusted input.

### D3.3 — CodeQL SAST workflow
- **מטרה:** ניתוח סטטי ל-JS/TS על כל PR.
- **קבצים:** `.github/workflows/codeql.yml` (חדש).
- **גישה:** `github/codeql-action` (init+analyze), pack javascript-typescript, על PR/push-main/schedule; `permissions: security-events: write, contents: read`.
- **בדיקות קבלה:** CodeQL רץ ומעלה SARIF; דפוס פגיע מזורע מופיע כ-alert.
- **Rollback:** מחיקת codeql.yml.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — SAST gate.

### D3.4 — Secret scanning (push protection + CI scan)
- **מטרה:** למנוע credentials שנכתבו מלהגיע ל-repo/היסטוריה.
- **קבצים:** `.github/workflows/` (secret-scan), `.gitleaks.toml` אופציונלי, הגדרות repo.
- **גישה:** GitHub Secret Scanning + Push Protection; gitleaks/trufflehog CI על diff + baseline; pre-commit hook אופציונלי.
- **בדיקות קבלה:** commit עם key מזויף נחסם ע"י push protection ומסומן ב-CI; diff נקי עובר.
- **Rollback:** הסרת step / כיבוי push protection.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — secret hygiene.

### D3.5 — Dependabot (npm + github-actions)
- **מטרה:** alerts רציפים ו-PRs אוטומטיים ל-deps ול-Actions.
- **קבצים:** `.github/dependabot.yml` (חדש), הגדרות repo.
- **גישה:** npm (root+workspaces) + github-actions, grouped minor/patch, schedule שבועי; security updates+alerts.
- **בדיקות קבלה:** Dependabot פותח PR נגד dep ישן; alerts מופיעים.
- **Rollback:** מחיקת dependabot.yml.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — continuous advisory automation.

### D3.6 — הקשחת GitHub Actions supply-chain + token scope
- **מטרה:** לצמצם blast-radius של פריצת CI.
- **קבצים:** `.github/workflows/ci.yml:53,56,61` (SHA-pin + `permissions: contents: read`), `.github/workflows/codeql.yml`, dependency-review חדש.
- **גישה:** pin של actions ל-commit SHA, `persist-credentials: false` ב-checkout, `actions/dependency-review-action` על PR; אופציונלי harden-runner + Scorecard.
- **בדיקות קבלה:** workflow ירוק; GITHUB_TOKEN read-only by default; dependency-review חוסם dep פגיע חדש.
- **Rollback:** restore @v4 tags + הסרת permissions.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** Level-3 — CI least-privilege/supply-chain.

### D3.7 — הכנסת argon2id dependency תחת בקרות supply-chain
- **מטרה:** primitive ל-hashing שצריך Epic B, בלי להחליש את ה-install-script allowlist.
- **קבצים:** `package.json:30` (`onlyBuiltDependencies`), `apps/web/auth.ts` + מודול password חדש (wiring בלבד כאן).
- **גישה:** `@node-rs/argon2` (prebuilt napi) או `argon2` (node-gyp) אחרי provenance review; pin + lockfile integrity; להעדיף prebuilt/WASM. לתכנן יציאה מ-next-auth beta (drift: שני @auth/core — 0.37.2 ו-0.41.2).
- **בדיקות קבלה:** hash/verify roundtrip ב-CI; pnpm audit נקי; `--frozen-lockfile` מצליח עם ה-allowlist.
- **Rollback:** הסרת ה-dep וה-entry.
- **סיכון:** בינוני. **תלויות:** —.
- **בקרה/חובה:** Level-3 — controlled crypto dependency.

---

# Epic B — סיסמה (argon2id) כאימות ראשי 🔒

> **כל ה-Epic הזה הוא 🔒 — נוגע ב-auth החי.** שער עצירה לאישור לפני merge/apply.
> **verdict:** ל-credential login אין בית — ה-tenant db (lib/db.ts) הוא REVOKE'd על identity tables;
> כל כתיבת credentials חייבת לרוץ על authDb (owner) דרך server actions/route handlers, לא memberProcedure.
> ה-JWT הוא stateless וכמעט בלתי-בטיל ל-7 ימים — חסם ארכיטקטוני שמחייב tokenVersion (B.2) לפני reset/2FA.

### B.1 🔒 — אחסון סיסמה argon2id (טבלת user_credentials נפרדת) + crypto config
- **מטרה:** לשמור hashes בלי לזהם את ספריית ה-PII users ובלי לתת ל-app-role גישה.
- **קבצים:** `packages/db/src/schema.ts` (טבלת `user_credentials`: userId PK→users.id cascade, passwordHash, passwordUpdatedAt, `tokenVersion int default 0`, `failedLoginCount`, `lockedUntil`, `totpSecretEnc null`, `totpEnabledAt null`), `packages/db/src/rls.ts` (REVOKE ALL על user_credentials/user_recovery_codes/password_reset_tokens מ-restomatch_app), `packages/db/drizzle/00xx_user_credentials.sql`, `packages/db/drizzle/rls/0002_core_tenant_rls.sql`, `apps/web/package.json`.
- **גישה:** argon2.hash/verify רק על authDb (owner); הצפנת totpSecret עם `AUTH_ENC_KEY`, לעולם plaintext.
- **בדיקות קבלה:** migration shape test; RLS attack — restomatch_app מקבל permission-denied על user_credentials; hash/verify + rehash-on-param-change unit.
- **Rollback:** טבלה+revokes additive; drop table. magic-link לא מושפע.
- **סיכון:** בינוני. **תלויות:** D3.7.
- **בקרה/חובה:** Level-3 — password storage; תיקון 13.

### B.2 🔒 — Session revocation דרך tokenVersion (תנאי מקדים ל-reset/2FA/"log out everywhere")
- **מטרה:** להפוך JWT stateless לבטיל כדי ש-reset ו-2FA יבטלו סשנים חיים.
- **קבצים:** `apps/web/auth.ts` (jwt callback:118-155 — להשוות `token.ver` ל-DB ver; לקפל את קריאת ver לתוך membership query הקיים; check על כל בקשה לאירועים רגישים), `apps/web/lib/passwords.ts`, `apps/web/middleware.ts` (ver-mismatch ⇒ unauthenticated).
- **גישה:** stamp `token.ver` ב-sign-in; פעולת "log out everywhere" מגדילה ver. **verdict caveat (Auth.js v5):** token מנוקה לא מבצע hard-revoke באמצע-בקשה — לכן לזווג עם middleware.
- **בדיקות קבלה:** אחרי reset, cookie קודם נדחה בבקשה הבאה; "log out everywhere" מנקה מכשירים; סשן רגיל שורד revalidation no-op.
- **Rollback:** ver check כ-no-op (column additive).
- **סיכון:** בינוני. **תלויות:** B.1.
- **בקרה/חובה:** Level-3 — session revocation; תיקון 13 — incident response.

### B.3 🔒 — Credentials provider (argon2id) כאימות ראשי + UI email+password, magic-link גיבוי
- **מטרה:** email+password ראשי; magic-link "שלח לי קישור" גיבוי.
- **קבצים:** `apps/web/auth.ts` (Credentials provider — **רק כאן**, auth.config.ts/middleware נשארים provider-less כדי ש-argon2 לא ייכנס ל-edge bundle), `apps/web/app/login/page.tsx` (server-action שמטפל ב-Auth.js CSRF — לא fetch ידני ל-callback), `apps/web/lib/email.ts`, `apps/web/lib/emailTemplates.ts`.
- **גישה:** authorize() — canonicalize email, fetch user+user_credentials על authDb, argon2.verify, **לדרוש emailVerified**, החזר uniform error (אין user-enumeration), הפעל lockout (C.2). Credentials דורש jwt strategy (כבר מוגדר). הרחב jwt initial-sign-in לשאת tokenVersion.
- **בדיקות קבלה:** Playwright — happy path; wrong password uniform error; unverified חסום; magic-link backup עובד. unit — authorize() מחזיר null בלי לדלוף קיום.
- **Rollback:** הסרת Credentials provider + revert login UI; magic-link נשאר מלא.
- **סיכון:** גבוה. **תלויות:** B.1.
- **בקרה/חובה:** Level-3 — password as primary; תיקון 13.

### B.4 🔒 — Signup/set-password + password-reset-via-magic-link
- **מטרה:** לאפשר למשתמשים שאומתו ב-magic-link להגדיר/לשנות/לאפס סיסמה.
- **קבצים:** `apps/web/app/(auth)/set-password/`, `apps/web/app/(auth)/reset/`, `apps/web/app/api/auth/*` (server actions), `apps/web/lib/passwords.ts` (server-only), `packages/db/src/schema.ts` (`password_reset_tokens` שמכיל רק sha256(rawToken), דפוס invitations team.ts:24-29), `apps/web/lib/emailTemplates.ts`.
- **גישה:** mutations כ-server actions/route handlers (authDb+argon2), **לא** memberProcedure. requestReset שולח קישור; resetPassword מאמת token+expiry, קובע hash, **מקפיץ tokenVersion** (הורג סשנים). changePassword מאמת סיסמה נוכחית ומקפיץ ver. rate-limit per-mailbox+IP.
- **בדיקות קבלה:** Playwright — set→login; reset קובע סיסמה ומבטל סשן ישן; token reused/expired נדחה; change-password דורש נוכחית.
- **Rollback:** feature-flag ל-CTA; reset routes additive; drop טבלה.
- **סיכון:** גבוה. **תלויות:** B.2, B.3.
- **בקרה/חובה:** Level-3 — credential lifecycle.

### B.5 🔒 — "Remember me" — אורך-סשן per-login עם rotation
- **מטרה:** סשן קצר (browser/1d) מול ארוך מתחדש (~30d) בבחירת login.
- **קבצים:** `apps/web/auth.ts` (jwt + cookies config), `apps/web/app/login/page.tsx`.
- **גישה:** **verdict caveat:** ל-Auth.js v5 אין per-login maxAge native — ב-jwt() קבע `token.rememberMe`+`token.exp` (קצר/ארוך) ב-sign-in **וגם** override ל-cookie Max-Age דרך `cookies.sessionToken.options` (שניהם נקבעים בנפרד ב-v5 — לקבוע את שניהם). sliding expiration עם cap מוחלט; לתעד השפעת AUTH_SECRET rotation על tokens ארוכים.
- **בדיקות קבלה:** on ⇒ persistent cookie עם Max-Age ארוך + exp תואם; off ⇒ session cookie; sliding מאריך עד ה-cap.
- **Rollback:** hard-code rememberMe=false (7d); הסתרת checkbox.
- **סיכון:** בינוני. **תלויות:** B.2.
- **בקרה/חובה:** Level-3 — session lifetime control (ask מפורש).

### B.6 🔒 — הקשחת Auth.js v5: edge-isolation, CSRF, emailVerified gate, env
- **מטרה:** להימנע מ-pitfalls של Credentials+JWT+edge ולאמת secrets חדשים ב-boot.
- **קבצים:** `apps/web/auth.ts`, `apps/web/auth.config.ts`, `apps/web/middleware.ts`, `apps/web/lib/env.ts`, `apps/web/instrumentation.ts`.
- **גישה:** argon2/otplib/crypto **אך ורק** ב-node-runtime auth.ts/server-only libs — לעולם לא ל-auth.config.ts/middleware (edge); server-action signIn() לכל POST credential/2FA; emailVerified כתנאי login ב-authorize() (כיום נבדק רק ל-admin allowlist); הרחב WebEnvSchema לדרוש `AUTH_ENC_KEY` בפרודקשן ולתעד AUTH_SECRET rotation; אישור trustHost:true בטוח מאחורי proxy.
- **בדיקות קבלה:** build assertion ש-edge bundle לא כולל argon2/otplib; env test ש-boot נכשל בלי AUTH_ENC_KEY בפרודקשן; CSRF negative (cross-origin POST ל-credentials callback נדחה).
- **Rollback:** הרפיית env ל-optional; edge-isolation הוא build constraint.
- **סיכון:** בינוני. **תלויות:** B.3.
- **בקרה/חובה:** Level-3 — auth hardening.

---

# Epic C — 2FA (TOTP) + account lockout 🔒

> **🔒 — נוגע ב-auth החי.** שער עצירה לאישור.

### C.1 🔒 — 2FA TOTP: enrollment + verify + recovery codes, אכיפה בשכבת ה-session
- **מטרה:** גורם שני אופציונלי שאי-אפשר לעקוף עם magic-link הגיבוי.
- **קבצים:** `apps/web/auth.ts` (`twoFactorPending` ב-jwt/session), `apps/web/middleware.ts`, `packages/api/src/trpc.ts` (authedProcedure דוחה pending), `apps/web/app/login/2fa/`, `apps/web/app/dashboard/settings/`, `packages/db/src/schema.ts` (`user_recovery_codes`), `apps/web/lib/totp.ts`.
- **גישה:** הוסף `otplib`+`qrcode`; secret מוצפן ב-user_credentials (`totpSecretEnc` עם AUTH_ENC_KEY); enrollment: secret→QR `otpauth://`→confirm code→`totpEnabledAt`→10 recovery codes כ-hashes (usedAt one-time). **gate ברמת session ולא בתוך authorize() של provider יחיד** — אחרי הגורם הראשון (password או magic-link), אם totpEnabledAt קיים ⇒ token עם `twoFactorPending:true`; middleware+authedProcedure מתייחסים ל-pending כלא-מאומת פרט ל-/login/2fa; שלב שני מאמת TOTP (±1 window) או recovery code ומנקה את ה-flag — כך magic-link **גם** אוכף 2FA. throttle.
- **בדיקות קבלה:** Playwright — enroll→confirm→logout→login דורש TOTP; קוד שגוי נדחה+throttle; recovery פעם אחת; magic-link גם מבקש 2FA; כיבוי 2FA דורש re-auth.
- **Rollback:** feature-flag enrollment off; בלי enrolled users ה-branch אינרטי.
- **סיכון:** גבוה. **תלויות:** B.2, B.3.
- **בקרה/חובה:** Level-3 — MFA; תיקון 13.

### C.2 🔒 — Account lockout / brute-force (login, TOTP, reset)
- **מטרה:** throttle+lockout דורבילי שמחזיק גם כש-Redis limiter fail-open.
- **קבצים:** `apps/web/auth.ts` (authorize lockout), `apps/web/lib/rateLimit.ts` (configs), `packages/api/src/rateLimit.ts`, `packages/db/src/schema.ts` (failedLoginCount/lockedUntil).
- **גישה:** (1) limiters keyed על canonicalizeEmail AND clientIpFromHeaders (edge.ts) ל-login/TOTP/recovery/reset; (2) backstop דורבילי ב-user_credentials: failedLoginCount+lockedUntil עם exponential backoff, נבדק/מעודכן ב-authorize() על authDb — שורד Redis outage. reset על success; הודעת "too many attempts" uniform בלי לחשוף lock state; Hebrew RTL עקבי עם auth.ts:60-63.
- **בדיקות קבלה:** Vitest — N כשלונות⇒lockedUntil; סיסמה נכונה בזמן lock נדחית; unlock אחרי חלון; success מאפס; keyed email+IP; Redis-down עדיין נועל דרך DB.
- **Rollback:** threshold=Infinity/דילוג DB check; limiter configs additive.
- **סיכון:** בינוני. **תלויות:** B.3.
- **בקרה/חובה:** Level-3 — brute-force lockout; תיקון 13.

---

# Epic E — משפטי / פרטיות (תיקון 13)

> **כל ה-copy המשפטי מסומן `[לאימות עו"ד]`** עד חתימת יועץ. דרושים פרטי הישות המשפטית הרשומה כדי
> לאכלס privacy policy + DPO designation (gap מהאודיט).

### E.1 — מדיניות פרטיות (Hebrew/RTL)
- **מטרה:** גילוי נדרש לנושאי המידע (סע' 11 לחוק) — איזה PII נאסף, מטרות, sub-processors, העברה חוצת-גבולות, retention, וזכויות תחת תיקון 13.
- **קבצים:** `apps/web/app/(marketing)/privacy/page.tsx` (חדש, RTL, MarketingShell), `apps/web/app/(marketing)/_components/MarketingShell.tsx` (footer link); תוכן מתוך inventory ב-schema.ts.
- **גישה:** סעיפים — זהות בעל-השליטה; קטגוריות PII (account/supplier/invoice-image/lead/usage); מטרות+בסיס חוקי; sub-processors+מדינות; בסיס העברה; retention; זכויות+כיצד לממש (link ל-E.6); cookies; יצירת קשר/ממונה. כל משפט מהותי עטוף `[לאימות עו"ד]` + banner reviewer.
- **בדיקות קבלה:** e2e — GET /privacy 200, RTL, טבלת sub-processors + סעיף rights; footer link בבית+marketing.
- **Rollback:** מחיקת route+link.
- **סיכון:** נמוך. **תלויות:** E.4 (טבלה), E.6 (rights link).
- **בקרה/חובה:** תיקון 13 — duty to inform (סע' 11).

### E.2 — תנאי שימוש (Hebrew/RTL)
- **מטרה:** תנאים חוזיים, acceptable use, אחריות, SLA framing.
- **קבצים:** `apps/web/app/(marketing)/terms/page.tsx` (חדש), MarketingShell footer link.
- **גישה:** skeleton (תיאור שירות, אחריות חשבון, billing→plans, IP, הגבלת אחריות, דין ישראלי, סמכות שיפוט). כל סעיף `[לאימות עו"ד]`.
- **בדיקות קבלה:** e2e — GET /terms 200 + footer link.
- **Rollback:** מחיקת route+link.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** consumer-disclosure.

### E.3 — Cookie-consent banner + מדיניות cookies
- **מטרה:** ליידע על cookies ולקבל consent לפני כל cookie לא-חיוני/analytics; לתעד את ה-Auth.js session/CSRF cookies (strictly-necessary).
- **קבצים:** `apps/web/app/layout.tsx` (mount), `apps/web/lib/components/CookieConsent.tsx` (חדש), `apps/web/app/(marketing)/cookies/page.tsx` (חדש), gate ב-`packages/observability/src/posthog.ts` consumers.
- **גישה:** banner שמגלה auth cookies תמיד, וחוסם analytics עתידי (PostHog) מאחורי opt-in; שמירת בחירה ב-first-party cookie; `isAnalyticsConsented()` gate.
- **בדיקות קבלה:** e2e — banner בביקור ראשון, בחירה נשמרת אחרי reload, אין קריאת analytics לפני opt-in.
- **Rollback:** הסרת mount; cookies functional-only.
- **סיכון:** נמוך. **תלויות:** E.1.
- **בקרה/חובה:** תיקון 13 — consent/cookies.

### E.4 — Sub-processor + RoPA register (DPA tracking)
- **מטרה:** RoPA + sub-processor register שמונה Supabase, Resend, Anthropic, Google Document AI, Upstash, Vercel, Fly.io, Meta/WhatsApp, MarketMan, Sentry, Higgsfield — עם קטגוריות, מטרה, מדינה, סטטוס DPA.
- **קבצים:** `docs/legal/SUBPROCESSORS.md` (חדש), `docs/legal/ROPA.md` (חדש), `docs/PILOT-CHECKLIST.md:79-80` (לסמן רק כש-DPA נחתם).
- **גישה:** מיפוי כל קטגוריית PII (schema.ts) ל-activity, בסיס חוקי, recipients, transfer mechanism, retention; DPA signed/pending per processor.
- **בדיקות קבלה:** CI doc-lint — לכל שורה country+DPA-status+data-category; טבלת privacy תואמת register.
- **Rollback:** docs-only.
- **סיכון:** נמוך. **תלויות:** —.
- **בקרה/חובה:** תיקון 13 — accountability/RoPA; תקנות אבטחת מידע 2017.

### E.5 — הערכת חוקיות העברה חוצת-גבולות לספקי OCR
- **מטרה:** לתעד ולקיים את בסיס תקנות העברת מידע לחו"ל 2001 עבור שליחת PII של מסמכים ל-Anthropic (US) ו-Google Document AI.
- **קבצים:** `docs/legal/ROPA.md` (transfer section); reference `packages/ocr/src/providers/_anthropic.ts:84-93`.
- **גישה:** לרשום בסיס ההעברה (התחייבות processor + onward-transfer limits, או adequacy ל-Google region 'eu'); לוודא Google נשאר 'eu' (.env.example:41); להסביר ש-scans נשלחים base64. מסקנה `[לאימות עו"ד]`.
- **בדיקות קבלה:** entry קיים ל-Anthropic+Google עם בסיס מתועד.
- **Rollback:** docs-only.
- **סיכון:** נמוך. **תלויות:** E.4.
- **בקרה/חובה:** תיקון 13 — cross-border transfer.

### E.6 — DSR flow: access / export / delete
- **מטרה:** לאפשר ל-users (ול-admin עבור leads) לממש access, export נייד, ומחיקה בנתיב אחד מבוקר.
- **קבצים:** `packages/api/src/routers/dsr.ts` (חדש), `packages/api/src/index.ts` (wiring), `apps/web/app/dashboard/settings/`, `apps/web/app/admin/leads/`, audit דרך audit_log (D2.2).
- **גישה:** `dsr.exportMyData` (user+memberships+authored ל-JSON/CSV), `dsr.deleteMyAccount` (anonymize/hard-delete; explicit anonymization היכן ש-cascade=set-null), `dsr.eraseLead` (admin). כל פעולה ל-audit_log; SLA בתוך החלון הסטטוטורי.
- **בדיקות קבלה:** unit — export מחזיר כל שורות-המשתמש; delete מסיר/מאנונם תוך שמירת tenant integrity; lead erase מסיר; כל פעולה כותבת audit; RBAC — non-owner לא מוחק אחרים.
- **Rollback:** feature-flag off; ללא schema change אם anonymization additive.
- **סיכון:** בינוני. **תלויות:** E.1, D2.2.
- **בקרה/חובה:** תיקון 13 — זכויות נושא מידע (סע' 13/13A).

### E.7 — תיעוד consent שיווקי + opt-out (חוק הספאם)
- **מטרה:** opt-in מוכח ללידים + unsubscribe על מסרים מסחריים (תיקון 40 לחוק התקשורת).
- **קבצים:** `apps/web/app/(marketing)/_components/LeadForm.tsx:155-157`, `packages/api/src/routers/leads.ts:31-38`, `packages/db/src/schema.ts:1145-1155` + migration (consent columns על leads), `packages/api/src/notifications/templates.ts` (unsubscribe footer ל-marketing class).
- **גישה:** checkbox מפורש (unchecked default) + privacy link; שמירת `consentText, consentAt, source IP`; `marketing_consent` boolean; unsubscribe token למיילים לא-transactional; operational alerts נשארים transactional.
- **בדיקות קבלה:** unit — leads.create רושם/דוחה consent; lead שומר consentAt; marketing template מכיל unsubscribe; transactional פטור.
- **Rollback:** revert migration (additive) + form change.
- **סיכון:** בינוני. **תלויות:** E.1.
- **בקרה/חובה:** סע' 30A לחוק התקשורת + consent basis.

### E.8 — מדיניות retention/minimization + purge job
- **מטרה:** להגדיר ולאכוף חלונות retention כך ש-PII נמחק/מאנונם כשאינו נחוץ.
- **קבצים:** `apps/worker/src/jobs/retention.ts` (חדש), `apps/worker/src/cron.ts`, `docs/legal/ROPA.md` (retention table).
- **גישה:** לתעד חלונות (הערה: מסמכי-מס עשויים לחייב ~7 שנים — `[לאימות עו"ד]`); cron שמטהר verification_tokens שפגו, leads לא-מאושרים ישנים, ומאנונם/מוחק מעבר לחלון; destructive מאחורי config+dry-run.
- **בדיקות קבלה:** unit — מוחק שורות מעל החלון ב-dry-run report; לא נוגע בתוך-החלון; tax-invoice scans מכובדים.
- **Rollback:** ביטול cron registration; idempotent+dry-run default.
- **סיכון:** בינוני. **תלויות:** E.4.
- **בקרה/חובה:** תיקון 13 — minimization/retention.

### E.9 — Breach-notification runbook + DPO designation + Sentry PII scrub
- **מטרה:** תהליך incident/breach לפי חובות תיקון 13, מינוי ממונה, ועצירת דליפת PII ל-Sentry.
- **קבצים:** `docs/legal/BREACH-RESPONSE.md` (חדש), `packages/observability/src/sentry.ts` (beforeSend scrub), סעיף יצירת-קשר ב-privacy.
- **גישה:** runbook (detection, severity, PPA+data-subject notification triggers/timelines `[לאימות עו"ד]`, roles); מינוי ממונה הגנת פרטיות/DPO; beforeSend מסיר emails/phones/tokens/tRPC input bodies.
- **בדיקות קבלה:** unit — beforeSend מצנזר email/phone/token; runbook מפרט thresholds.
- **Rollback:** docs-only + revert scrubber (safe-by-default).
- **סיכון:** נמוך. **תלויות:** E.1.
- **בקרה/חובה:** תיקון 13 — breach notification + DPO.

---

# Epic F — נכסי שיווק Higgsfield (אופציונלי)

### F.1 — נכסי Higgsfield + רישום ב-sub-processor register
- **מטרה:** הפקת נכסי שיווק (out-of-band) + רישום ב-register גם אם לא נוגע ב-PII.
- **קבצים:** `docs/legal/SUBPROCESSORS.md` (entry ל-Higgsfield עם data-flow note), נכסים תחת `apps/web/public/` או assets pipeline נפרד.
- **גישה:** Higgsfield אינו מופיע בקוד (grep נקי) — ככל הנראה ידני; עדיין צריך register entry שמתעד אם נוגע ב-PII.
- **בדיקות קבלה:** register entry קיים עם data-category; נכסים נטענים.
- **Rollback:** docs/assets-only.
- **סיכון:** נמוך. **תלויות:** E.4.
- **בקרה/חובה:** תיקון 13 — sub-processor register completeness.

---

# סדר תלויות וריצוף (Dependency order & sequencing)

**עיקרון:** מה שניתן ללא נגיעה ב-auth/RLS-החי ראשון; חשיפת ה-PII הקריטית (דלי public) ראשונה; auth-overhaul רק אחרי
שה-foundation (boot-guard, tokenVersion-readiness, headers, audit) מוכן.

**גל 1 — חשיפה קריטית + foundation זול (ללא auth-overhaul):**
- A.1 → A.2 → A.3 → A.4 (storage isolation; A.1/A.2/A.3/A.4 = 🔒) — סוגר את החשיפה שאומתה חיה (public bucket).
- 0.1 → 0.2 (boot-guard + fail-closed) — quick win.
- 0.3 (🔒) → 0.4 (🔒) (RLS provisioning automation + audit immutable).
- D1.1 → D1.2 (headers + CSP Report-Only), D1.5 (OCR hardening), D1.4 (public tRPC fix), D1.7 (open-redirect).

**גל 2 — supply-chain + observability + השלמות storage/RLS:**
- D3.1–D3.6 (CI gates), D3.2 (xlsx) במקביל.
- A.5 (storage attack-test), A.6, A.7 (🔒), A.8, 0.5, 0.6.
- D2.2 (audit logging, תלוי 0.4), D2.3 (logging/monitoring), D2.1 (encryption), D2.4 (rotation, תלוי 0.3), D2.5 (backups).
- D1.3, D1.6.

**גל 3 — auth-overhaul (כולו 🔒, אחרי שער אישור):**
- D3.7 (argon2 dep) → B.1 → B.2 → B.3 → {B.4, B.5, B.6} → C.1 → C.2.

**גל 4 — משפטי/פרטיות (ניתן להריץ במקביל מגל 1, אך E.1 תלוי E.4+E.6):**
- E.4 → E.5; E.1 → {E.2, E.3, E.6, E.7, E.8, E.9}; F.1 (אחרי E.4).
- E.6 (DSR) תלוי גם ב-D2.2 (audit). E.9 Sentry-scrub חופף ל-D2.3.

**שלושת ה-PRs המומלצים ראשונים:**
1. **PR1 — בידוד אחסון קריטי (A.1+A.2+A.3):** הפיכת הדלי לפרטי, storage RLS פר-prefix, והעברת upload לשרת. סוגר את החשיפה היחידה שאומתה חיה (PII world-readable). 🔒 — שער אישור.
2. **PR2 — Web headers + OCR hardening + boot-guard (D1.1+D1.2-RO+D1.5+0.1+0.2):** baseline headers + CSP Report-Only, הקשחת ה-OCR הלא-מאומת, ו-fail-closed על חיבור ה-DB. סיכון נמוך, ערך גבוה, ללא נגיעה ב-login.
3. **PR3 — Audit-log immutable + RLS provisioning automation (0.4+0.3+D2.2):** audit append-only + provisioning מאומת + audit-logging מקיף. בסיס ל-Level-3 audit integrity ולציות תיקון 13. 🔒 — שער אישור.
