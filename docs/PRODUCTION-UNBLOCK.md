# שחרור חסימות ל-Production — מה צריך ממך

כל עבודת הקוד שלא דורשת מפתחות כבר בוצעה (UX/UI, `invoice_scans`, RLS SQL, Resend
dispatcher, ניתוק mocks, env/docs). מה שנשאר חסום דורש credentials/חשבונות שרק לך
יש גישה אליהם. ספק אותם ואני מחווט ומאמת.

> **אבטחה:** אל תדביק secrets בצ'אט. שים אותם ב-`apps/web/.env.local` (פיתוח) או
> ב-env של ספק הפריסה (production), ותגיד לי "הוגדר".

| # | מה שחסום | מה צריך | מאיפה משיגים | משתני env | מה זה פותח |
|---|----------|---------|--------------|-----------|------------|
| 1 | **איחוד DB ל-Supabase** | connection strings + service key | Supabase → Settings → Database (Connection pooling) + Settings → API | `DATABASE_URL` (pooled 6543), `DATABASE_URL_DIRECT` (5432), `SUPABASE_SERVICE_ROLE_KEY` | הרצת migrations (כולל `0003`) על Supabase, החלת קובצי ה-RLS, ניתוק מ-Postgres מקומי |
| 2 | **OCR אמיתי** | מפתחות 2 ספקים | console.anthropic.com + Google Cloud Document AI | `ANTHROPIC_API_KEY`, `GOOGLE_DOCUMENT_AI_PROJECT_ID`, `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (נתיב ל-service-account JSON) | מימוש OCR אמיתי ב-`documentAi.ts`/`claudeVision.ts` + reconciliation במקום fixtures |
| 3 | **Auth email (Resend)** | API key + אימות דומיין | resend.com | `RESEND_API_KEY` | אריץ `pnpm --filter @restomatch/web add resend`, אחליף את provider של Auth.js מ-Nodemailer ל-Resend + תבנית מייל בעברית (ה-dispatcher כבר ממומש) |
| 4 | **MarketMan (PO sync)** | API key | חשבון MarketMan | `MARKETMAN_API_KEY` (+ `MARKETMAN_BASE_URL`) | סנכרון הזמנות אמיתי (ה-adapter + 17 טסטים כבר קיימים) |
| 5 | **WhatsApp Cloud** | טוקנים מ-Meta | Meta Business → WhatsApp | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | התראות WhatsApp אמיתיות (ה-notifier כבר ממומש) |
| 6 | **Observability** (אופציונלי) | DSN/key | sentry.io + posthog.com | `SENTRY_DSN`, `POSTHOG_API_KEY` | חיווט env-gated של `@restomatch/observability` ל-web+worker |
| 7 | **Deploy** | חשבונות | Vercel (web), Fly.io (worker), Upstash (Redis) | `REDIS_URL` + הגדרת env בכל ספק | פריסה לפי `docs/DEPLOY.md` |

## מה אעשה ברגע שתספק (לפי סדר מומלץ)
1. **Supabase (#1)** — לאחד DB, להריץ migrations + RLS, smoke test. זה הצעד הקריטי הראשון.
2. **Resend (#3)** — מהיר, פותח login אמיתי.
3. **OCR (#2)** + **MarketMan (#4)** + **WhatsApp (#5)** — חיווט ה-scaffolds.
4. **Observability (#6)** + **Deploy (#7)** — הקשחה ועלייה לאוויר.

עדכון אחרון: מצב הקוד אחרי סבב ה-UX/UI + הכנת התשתית. ראה `PROD-PROMPT.md` לתוכנית המלאה.
