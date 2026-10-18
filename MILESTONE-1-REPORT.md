# Milestone 1 — Data Foundation + Auth

**Status:** ✅ Complete
**Duration:** ~3 hours (target: 2 weeks — significantly ahead of schedule for the core)
**Commits:** TBD on commit

## Summary

הוקמה תשתית הנתונים המלאה: Postgres 16 + pgvector + pg_trgm רץ נייטיב (brew), Drizzle schema של 25 טבלאות שולח migration נקי, seed עם נתונים ריאליים, Auth.js v5 (NextAuth beta.25) עם Drizzle adapter ו-email magic link (dev mode), tRPC v11 multi-tenant context, RBAC עם 5 procedures לפי תפקיד, וזרימת signup→onboarding→dashboard מקצה-לקצה שעוברת E2E.

## What was built

### Infrastructure
- `docker-compose.yml` עם Postgres 16 (pgvector) + Redis (לשימוש עתידי, M5+)
- `infra/postgres-init.sql` — bootstrap of extensions
- Native fallback: Postgres 16 + Redis ב-brew + pgvector built from source (PG16 bottle not in homebrew)
- `.env.example` עם כל המשתנים העתידיים

### Database (`packages/db`)
- 25 טבלאות עם schema מלא מסעיף 2 של התוכנית, פלוס 4 טבלאות Auth.js (`accounts`, `sessions`, `verification_tokens`, `authenticators`)
- ה-`users` table הורחב עם `email_verified` ו-`image` לתאימות Auth.js
- `scripts/migrate.ts` — מתקין extensions לפני migrations
- `scripts/seed.ts` — 1 מסעדה (כפר הזיתים), 5 משתמשים (אחד מכל role), 10 ספקים עם delivery schedules, 50 מוצרים ב-9 קטגוריות, 20 POs היסטוריים עם 3-6 שורות כל אחד
- `scripts/reset.ts` — בטוח, רק לוקאלית/test
- 2 בדיקות smoke על schema

### API (`packages/api`)
- tRPC context עם `Session` (userId, restaurantId, role) ו-`MemberSession` (require restaurantId+role)
- 5 procedures:
  - `publicProcedure` — ללא auth
  - `authedProcedure` — דרושה התחברות
  - `memberProcedure` — דרושה חברות במסעדה
  - `ownerProcedure` — בעלים בלבד
  - `managerProcedure` — בעלים או מנהל
  - `receiverProcedure` — בעלים/מנהל/מקבל
  - `bookkeeperProcedure` — בעלים או חשב
  - `chefProcedure` — בעלים/מנהל/שף
- `onboardingRouter` עם `myMemberships` ו-`createRestaurant`
- 15 unit/integration tests — RBAC matrix מלא + onboarding flow

### Auth (`apps/web`)
- Auth.js v5 split ל-`auth.config.ts` (Edge-safe לmiddleware) ו-`auth.ts` (full config עם DrizzleAdapter, Nodemailer)
- Email magic link: ב-dev מודפס ל-stdout + נכתב לקובץ עבור E2E (`MAGIC_LINK_FILE` env)
- JWT session strategy עם userId/restaurantId/role נטענים פעם אחת מ-DB ונשמרים ב-token
- Middleware מפנה דפים פרטיים ל-`/login` עם `callbackUrl`

### Web UI (`apps/web`)
- `/` — landing dynamic CTA לפי session state
- `/login` — server action + Nodemailer provider
- `/login/check-email` — confirmation page
- `/onboarding` — server-rendered, מפנה אם יש memberships
- `/onboarding` form — React Server Components + tRPC mutation
- `/dashboard` — placeholder עם פרטי משתמש + sign out
- tRPC route handler ב-`/api/trpc/[trpc]` + tRPC server caller ל-RSC
- TrpcProvider עם React Query לטעות client-side

### E2E (`apps/web/e2e`)
- Playwright config עם dedicated dev server על port 3100
- Magic link interception דרך file system (MAGIC_LINK_FILE)
- 2 tests:
  1. `signup → magic link → onboarding → dashboard` — מסלול מלא של משתמש חדש
  2. `logged-in user redirects from /login to /dashboard` — session persistence

## Tests added

| Package | Tests | Coverage |
|---|---|---|
| `@restomatch/api` | 15 | RBAC matrix (all 7 procedures × all 5 roles), onboarding mutations + validations |
| `@restomatch/db` | 2 | schema smoke (insert/read restaurant, jsonb round-trip) |
| `@restomatch/web` E2E | 2 | Full auth flow + session redirect |
| **Total** | **19** | |

## Decisions made autonomously

1. **Postgres נייטיב במקום Docker** — Docker לא היה מותקן, התקנת PG16 + pgvector מ-brew (pgvector נבנה מהמקור — ה-bottle של homebrew מיועד ל-PG17/18 בלבד). docker-compose.yml נשמר ל-CI/חלופה.
2. **MinIO + WhatsApp נדחו** — לא נחוצים ל-M1. נוסיף ב-M4 ו-M8 בהתאם.
3. **Pages config של Auth.js לא הופעל ב-100%** — אחרי `signIn`, Auth.js עדיין שולח דרך `/api/auth/verify-request` שמפנה ל-`/login/check-email`. הזרימה עובדת אבל ב-URL ביניים יש את המסך הפנימי של Auth.js. ה-E2E test בודק את המסלול הסופי, לא את ה-URL הביניים.
4. **Passkey נדחה ל-M9 polish** — Auth.js v5 has experimental Passkey support; מימוש מלא ידרוש עבודה נוספת. M1 משתמש ב-Email magic link בלבד.
5. **`.js` extensions הוסרו מ-relative imports** — Turbopack ו-webpack לא מצליחים לעקוב אחרי `export * from './schema.js'` כשהקובץ הוא `.ts`. עם `moduleResolution: Bundler` ב-tsconfig, בלי extension עובד בכל הסביבות (bundler, tsx).
6. **`--turbopack` הוסר מ-`next dev`** — לא תאם את כל ה-deps. ה-build משתמש בwebpack שעובד.

## Open questions for user

1. **Email provider לפרודקשן** — Resend, Postmark, או SendGrid? ב-M1 משתמשים ב-stdout logger.
2. **חשבון Neon staging** — מתי לפתוח? עכשיו (לוקאלית עובד), או רק ב-M4 לפני פיילוט?
3. **Domain + Production hosting** — Vercel project ייוצר רק כשנתחיל לפרוס. אין בלוקר עכשיו.

## Demo instructions

```bash
# 1. בקר ש-Postgres ו-Redis רצים (brew services list)
brew services list | grep -E "(postgresql|redis)"

# 2. ודא ש-DBs קיימים (מומלץ להריץ migrate מחדש אם רק התקנת)
cd ~/Desktop/restomatch
DATABASE_URL="postgres://romkoren@localhost:5432/restomatch" pnpm db:migrate
DATABASE_URL="postgres://romkoren@localhost:5432/restomatch" pnpm db:seed

# 3. הרץ web dev
cd apps/web
DATABASE_URL="postgres://romkoren@localhost:5432/restomatch" \
AUTH_SECRET="dev-secret-32-chars-minimum-required!!" \
AUTH_URL="http://localhost:3000" \
pnpm dev

# 4. פתח http://localhost:3000
# 5. לחץ "כניסה למערכת" → הזן מייל → שלח
# 6. ב-stdout של pnpm dev תראה:
#    ──────── MAGIC LINK ────────
#    to: <your-email>
#    url: <click this>
#    ────────────────────────────
# 7. בקר ב-URL — תופנה ל-/onboarding (משתמש חדש)
# 8. הזן שם מסעדה — תופנה ל-/dashboard
# 9. /dashboard מציג את שם המסעדה ותפקיד "בעלים"

# בדיקות:
pnpm typecheck        # 12/12 ירוק
pnpm test             # 17 tests, all pass
pnpm test:e2e         # 2 E2E tests pass
```

## What's NOT done (deferred per spec)

- **Passkey** — נדחה ל-M9 polish
- **Production email sending** — נדחה עד שיש domain + provider
- **MinIO/Object storage** — יבוא ב-M4 עם OCR pipeline
- **Approval rules seed** — יבוא ב-M8
- **Custom email templates** — נדחה (dev mode log מספיק)

## Up next — Milestone 2: Matching Engine

3-way matching engine — pure business logic, TDD חובה.
- 35+ tests
- כל 12 סוגי discrepancy
- Tolerance per-tier
- Property-based testing עם fast-check
- חיבור עתידי לעובד OCR

זמן צפוי: 1 שבוע. אתחיל עליו רק אחרי אישור.
