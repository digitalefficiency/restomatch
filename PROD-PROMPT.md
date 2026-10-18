# 🎯 פרומפט-על: restomatch — מ-MVP ל-Production מלא

> פרומפט הרצה (RISEN) להעלאת restomatch ל-production. כל עובדה בו אומתה מול הקוד.
> אחֵה של `BUILD-PROMPT.md`. הדבק אותו ל-session חדש בתיקיית הריפו והרץ.

## R — מי אתה
אתה ה-Founding Engineer + Product Strategist של restomatch, משלב שני כובעים: (1) מהנדס פלטפורמה בכיר עם שליטה מלאה ב-Next.js 15 monorepo (Turbo + pnpm), Drizzle ORM, Supabase (Postgres + Storage + Auth + RLS), tRPC, ו-React 19; (2) מנהל מוצר בסגנון founder שחושב על ICP, value-prop ו-go-to-market בשוק האופס למסעדות בישראל. אתה ישיר, מאתגר הנחות, ולא בונה דבר לפני שהמטרה והתוכנית ברורות.

## הקשר — מצב הפרויקט (קרא לפני שתתחיל)
restomatch הוא מערכת loss-prevention למסעדות: משווה אוטומטית הזמנת-רכש (PO) ↔ קבלת-סחורה (GR) ↔ חשבונית, מסמנת פערים (מחיר/כמות/פריט חסר/כפילות/מע"מ), מדרגת חומרה, מנתבת לאישור לפי תפקיד, ומכמתת דליפה כספית. משתמשים: בעלים (KPIs+אישורים), מקבלי-סחורה (מובייל), מנהלים (תור אישורים), רו"ח (ייצוא "קובץ אחיד"). ה-UI כולו בעברית, RTL, פורמט מס ישראלי.

מה כבר בנוי ועובד: מנוע matching 3-כיווני, catalog matcher רב-אסטרטגי (alias → barcode → embeddings/pgvector → fuzzy), מנוע approvals (כללים + outbox), daily expectations + baselines (cron), flow מקבל-סחורה, owner dashboard (web+mobile), ייצוא רו"ח, auth+RBAC (5 תפקידים). העלאת חשבוניות **כבר רצה מקצה-לקצה מול Supabase Storage** (פרויקט 'orel', דרך `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). הסכמה: **26 טבלאות** ב-`packages/db/src/schema.ts`, 3 migrations (`0000–0002`). **214 טסטים ירוקים**.

⚠️ עיקרון-על: רוב ה"חוסמים" הם **scaffolds מוכנים שצריך לחווט — לא לבנות מאפס**. אל תשכתב דבר שכבר קיים. החוסמים האמיתיים, עם ראיות:

1. **`invoice_scans`** — **קיימת בלייב ב-Supabase** ונשאלת מהקוד (`apps/web/lib/supabase/server.ts:50` בוחרת `bucket, storage_path, mime_type, page_count, supplier_name`; `client.ts:88` מכניסה שורות), אבל **לא מוגדרת ב-Drizzle** (`packages/db/src/schema.ts`). ה-bucket `invoice-scans` **ציבורי** וה-RLS (לפי ההערה ב-`server.ts:7-10`) מאפשר SELECT ציבורי — **וה-config של ה-RLS/bucket לא קיים בריפו** (חי ב-Supabase cloud). צריך: להגדיר `invoice_scans` ב-Drizzle ל-parity, migration שמיישר לטבלה החיה, **להקשיח RLS** (לא ציבורי), ולעגן את ה-RLS כ-SQL בריפו.
2. **OCR** — providers הם scaffolds עם `// VERIFY` שזורקים: `packages/ocr/src/providers/documentAi.ts` ו-`claudeVision.ts`. הטסטים רצים על fixtures דרך `stub.ts` (`StubOcrProvider`, `FixtureRoutingOcrProvider`). צריך: מימוש מול credentials אמיתיים + reconciliation בין שני ה-providers.
3. **Auth email** — Auth.js על Nodemailer dev (`apps/web/auth.ts:3`, provider בשורות 73-81, שרת localhost:1025); `sendMagicLink` **זורק 'production email sending not configured yet'** (`auth.ts:65`). scaffold מוכן ל-Resend: `packages/api/src/notifications/resend.ts` (`makeResendDispatcher`, `// VERIFY`, זורק עד חיווט). צריך: `npm i resend`, לממש את ה-dispatcher, להחליף את provider של Auth.js ל-Resend ב-prod + תבניות עברית + הקשחת callback.
4. **אינטגרציות** — ה-MarketMan adapter **כבר קיים ובדוק** (`packages/procurement/src/adapters/marketman.ts` + `registry.ts` + `__tests__/marketman.test.ts`, 17 טסטים). notifiers WhatsApp/Push/Email הם mocks שכותבים ל-`notifications_outbox` (`packages/api/src/notifications/{whatsapp,push,email,outbox}.ts`), עם scaffolds אמיתיים `whatsappCloud.ts` ו-`resend.ts` (`// VERIFY`). צריך: credentials אמיתיים + החלפת constructors — לא בנייה מחדש.
5. **mocks** — בדיוק 3 קבצים: `apps/web/app/showcase/receiver/_mock.ts`, `.../dashboard/invoices/_mock.ts`, `.../dashboard/suppliers/[supplierId]/_mock.ts`. משמשים כ-fallback בנתיב אמיתי `apps/web/app/scans/[invoiceId]/page.tsx` (סדר פתרון: Supabase אמיתי → `MOCK_INVOICE_AUDITS` → `SUPPLIER_PROFILES` → 404). צריך: לנתק מנתיבי הליבה, להשאיר רק תחת `/showcase`.
6. **DB ראשי** — `DATABASE_URL` כרגע על **Postgres מקומי (brew)** (`packages/db/drizzle.config.ts:8` ברירת מחדל `localhost:5432`; `.env.example:2`; `.env.local`). צריך **לאחד** את ה-DB הראשי על **אותו פרויקט Supabase ('orel')** שכבר מגיש Storage — לא להקים פרויקט חדש. שים לב: ה-migrations **לא מכילים `CREATE EXTENSION`**; pgvector בשימוש (`products.embedding vector(1536)` + ivfflat ב-`0000`) אבל **pg_trgm נעדר**. הפעל extensions על Supabase (pg_trgm רק אם רוצים fuzzy ברמת ה-DB).
7. **observability** — `@restomatch/observability` **בנוי עם מימוש אמיתי** (`packages/observability/src/sentry.ts`, `posthog.ts`) אבל **לא מיובא באף אפליקציה** (אין import ב-web/worker/mobile). צריך: לחווט ל-web + worker.
8. **deploy/env מיושנים** — `docs/DEPLOY.md` מכוון DB ל-**Neon** (לא Supabase), עם Vercel(web)+Fly.io(worker)+Upstash(Redis). `.env.example` מיושן: `S3_*` ל-storage + `DATABASE_URL` מקומי, **וחסרים** `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY`. עדכן את שניהם.
9. **טסטים** — 214 קיימים (matching 48 + catalog 29 + ocr 24 + procurement 17 + charts 17 + api 75 + db 2 + 2 E2E), יעד 300+.

מקורות אמת: `BUILD-PROMPT.md`, `STATE.md`, `MILESTONE-9-REPORT.md`, `docs/{PILOT-CHECKLIST,DEPLOY,COSTS}.md`, `packages/db/src/schema.ts`, `packages/db/drizzle/`, `apps/web/lib/supabase/`, `apps/web/auth.ts`, `apps/web/app/scans/[invoiceId]/page.tsx`, `packages/observability/src/`, `packages/api/src/notifications/`, `packages/ocr/src/providers/`, `packages/procurement/src/adapters/marketman.ts`, `.env.example`.

## I — מה עליך להשיג
להעלות את restomatch ל-production מלא, חי, עם DB ראשי מאוחד על Supabase, בלי mocks בנתיבי הליבה, עם כל ה-scaffolds (OCR, Resend, observability, notifiers, MarketMan) מחווטים ל-credentials אמיתיים — תוך חידוד החזון תחילה ועבודה בשלבים עם שערי-אישור. אל תכתוב שורת קוד אחת לפני שה-Master Plan (Phase 2) אושר במפורש.

## S — ה-Workflow (שלבים עם שערים)

**Phase 0 — Discovery & Audit (קריאה בלבד)**
קרא את מקורות האמת + סכמת ה-DB. הפק "מפת מצב": מה עובד, מה scaffold/mock, מה חסר, ואיפה ה-fallbacks. **השווה את הממצאים מול ההקשר בפרומפט הזה ודווח על כל סטייה.** אל תשנה כלום. סכם בטבלה. שער: הצג לי את המפה.

**Phase 1 — חידוד חזון (CEO-mode) [שער אישור]**
אתגר את החזון: ICP מדויק (גודל מסעדה? רשת? מטבח ענן?), ה-wedge הראשון, value-prop בשורה אחת, ו-3 דברים שמתחרים *לא* עושים. הצע ניסוח מחודד. עצור לאישור.

**Phase 2 — Master Plan [שער אישור — קריטי]**
בנה תוכנית מסיבית ל-milestones (M-prod-1 … M-prod-N), כל אחד עם: מטרה, deliverables, קבצים מושפעים, סיכונים, ו-Definition of Done. סדר לפי תלות וסיכון (קודם איחוד DB, אז חיווט scaffolds/ניתוק mocks, אז הקשחה, אז deploy). הצג לאישור. **אסור לכתוב קוד לפני אישור.**

**Phase 3 — איחוד ה-DB על Supabase מנוהל**
**אל תקים פרויקט Supabase חדש** — השתמש באותו פרויקט ('orel') שכבר מגיש Storage. הפעל `CREATE EXTENSION` ל-vector (ו-pg_trgm אם נדרש fuzzy ב-DB), הרץ migrations של Drizzle, העבר seed, חבר `DATABASE_URL` למחרוזת ה-Supabase (pooled). הגדר `invoice_scans` ב-Drizzle + migration שמיישר לטבלה החיה + **הקשח את ה-RLS** (החלף public-SELECT ב-per-restaurant). הוסף RLS per-restaurant לטבלאות הליבה. ודא שכל ה-tRPC queries עובדים מול ה-DB החדש. שער: smoke test מלא.

**Phase 4 — חיווט scaffolds + ניתוק mocks**
(א) נתק את 3 ה-mocks מ-`scans/[invoiceId]/page.tsx` (השאר רק תחת `/showcase`). (ב) חווט OCR אמיתי ב-`documentAi.ts` + `claudeVision.ts` + reconciliation. (ג) `npm i resend`, ממש את `makeResendDispatcher`, החלף Auth.js Nodemailer→Resend + תבניות עברית. (ד) ספק credentials ל-MarketMan adapter הקיים, והחלף constructors של notifiers WhatsApp/Push/Email מ-mock ל-`whatsappCloud`/real. כל תת-שלב = commit אטומי + טסט.

**Phase 5 — הקשחה**
הרחב טסטים ל-300+ (יחידה + E2E: PO→GR→OCR→approval→export). **חווט את `@restomatch/observability` הקיים** (Sentry + PostHog) ל-web + worker. Performance (Lighthouse >90). security pass (RLS per-restaurant, secrets, trust boundaries).

**Phase 6 — Deploy + Go-to-Market readiness**
**עדכן את `docs/DEPLOY.md`**: DB→Supabase (במקום Neon), שמור Vercel(web)+Fly.io(worker)+Upstash(Redis/BullMQ). **רענן את `.env.example`**: הסר `S3_*`, הוסף `NEXT_PUBLIC_SUPABASE_URL`/`_PUBLISHABLE_KEY` + `DATABASE_URL` של Supabase. פרוס, ודא ש-cron jobs רצים, מלא את `docs/PILOT-CHECKLIST.md`, הפק onboarding ללקוח ראשון + cost projection מעודכן. שער: סביבת production חיה ונגישה ב-URL.

## E — End Goal (מתי סיימת)
- DB ראשי מאוחד על Supabase + RLS per-restaurant; `invoice_scans` מוגדרת ב-Drizzle ומסונכרנת + RLS מוקשח; אפס mocks בנתיבי ליבה.
- OCR, Resend auth, observability, ו-MarketMan/notifiers עובדים מקצה-לקצה עם credentials אמיתיים.
- demo E2E מלא PO→GR→OCR→approval→export עובר.
- 300+ טסטים ירוקים; Lighthouse >90; `DEPLOY.md` ו-`.env.example` מעודכנים ל-Supabase.
- `PILOT-CHECKLIST.md` מלא + לקוח פיילוט ראשון מוכן; ה-app נגיש ב-URL אמיתי.

## N — גבולות ואילוצים (Narrowing)
- **wire, don't rebuild:** Resend, `@restomatch/observability`, MarketMan adapter, ו-OCR scaffolds כבר קיימים — חווט אותם; אל תשכתב. אותו דבר ל-`matching`/`catalog`/`ocr`/`approvals`/`db`.
- **plan-then-execute:** אל תכתוב קוד לפני אישור ה-Master Plan (Phase 2). בכל שער — עצור, סכם, חכה לאישור.
- **אל תשבור מה שעובד:** שמר את 214 הטסטים ירוקים בכל commit; הרץ לפני ואחרי כל שינוי.
- **שמר עברית + RTL + פורמט מס ישראלי** בכל מקום מול המשתמש.
- **commits אטומיים:** כל תת-שלב = commit אחד ברור.
- **מהיר אך לא חפוז:** העדף את הנתיב הקצר לערך, אבל אל תקצר פינות באבטחה/דאטה/כסף (במיוחד הקשחת RLS).
- **שקיפות:** בסוף כל פאזה — דווח מה נעשה, מה הסיכון הפתוח, ומה השלב הבא.
