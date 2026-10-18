# Client-ready sprint — shared brief for every parallel session

**Goal (owner, 2026-10-18):** tomorrow the owner presents RestoMatch to a client. Turn the
project into a **ready, efficient, demo-able product**: research what works and what doesn't,
fix it at fine resolution (with tests), propose more fixes/features, significantly upgrade the
landing page, fix everything database-related, and ship **full English support** — headlined
by **"Receiver in English"**: a Hebrew invoice is uploaded and a non-Hebrew-speaking receiver
(often a foreign worker) sees the invoice lines **and the products** in English so they can
check the delivery themselves.

Base branch for all sessions: **`claude/client-ready`** (= latest code `wave0/s2-seed-exclusivity`
+ the i18n foundation + migration 0028). Each session works on its own branch
`claude/client-ready-<area>` and opens a **draft PR into `claude/client-ready`**. The
orchestrating session merges everything, runs the full gate, and opens the single PR.

## Hard rules

- **Never** touch production: no Supabase prod writes, no Vercel deploys, no real email/WhatsApp,
  no spending. Local Postgres/Redis only.
- **Stay inside your write boundary** (table below). Shared files you may need to touch are listed
  per-session; anything else → write it in your report under "Needs another area".
- **Never weaken a test** or delete an assertion. Add tests for every fix. The matching
  `leak-canary` is sacred — if your change moves the canary number, stop and explain why in the
  report instead of editing it.
- Files on the AGENTS.md immutability list (engine.ts, schema.ts, rls.ts, approvals/engine.ts,
  cron.ts, outbox.ts, leads.ts, plans.ts, CI workflows…) **may be changed in this sprint because the
  owner explicitly asked**, but only when needed, minimally, with a test, and every such file must be
  listed under "Immutable files touched" in your report so the owner reviews them consciously.
- Keep Hebrew as the default UX; English is additive. Do not break RTL.
- Commit early and often with clear messages; push your branch at least every ~45 minutes so
  progress isn't lost if the container restarts.

## Environment (each session runs in its own container)

```bash
./scripts/dev-setup.sh            # deps, Postgres 16 + pgvector, Redis, migrate test+dev DBs, seed demo, apps/web/.env.local
pnpm --filter @restomatch/web dev # http://localhost:3000
export DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test
pnpm test                          # full suite (≈730 tests, all green at the base)
pnpm --filter <pkg> exec vitest run <file>      # single file
pnpm --filter @restomatch/web exec tsc --noEmit -p .   # web typecheck (0 errors at the base)
cd apps/web && set -a && . ./.env.local && set +a && pnpm build   # prod build (green at the base)
```

- Containers can restart: if Postgres/Redis are down, `service postgresql start; redis-server --daemonize yes`.
- Seeded demo tenant: restaurant "כפר הזיתים", users `owner@ / manager@ / receiver@ / bookkeeper@ /
  chef@kfar-hazeitim.test`. Seed users have **no password** — log in via magic link: submit the email
  on `/login` (magic-link form) and read the URL from `$MAGIC_LINK_FILE` (see `.env.local`) or the dev
  server log. Session S1 is adding a demo password to the seed.
- No `ANTHROPIC_API_KEY` locally → OCR runs on fixture stubs; anything that calls Claude must have a
  deterministic offline fallback and must be unit-tested without the network. Chromium for
  Playwright is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never `playwright install`).

## i18n — how English works (already built)

- Locale = cookie `rm_locale` (`he` default | `en`). `?lang=en` on any URL sets it (middleware).
  `<html lang dir>` follows it (root layout). `LocaleSwitcher` (lib/i18n/LocaleSwitcher.tsx) is
  already in the marketing header and the dashboard header.
- Messages live in `apps/web/lib/i18n/messages/<namespace>/{he,en,index}.ts`. Hebrew is the source of
  truth; `en.ts` is typed `Shape<typeof he>` so a missing English key is a type error, and
  `lib/__tests__/i18n.test.ts` fails on missing/empty keys, mismatched `{placeholders}` or Hebrew left
  in English strings.
- Server component: `const t = await getT(ns)` (`@/lib/i18n/server`). Client component:
  `const t = useT(ns)` / `useLocale()` (`@/lib/i18n/client`). Import the namespace from its own folder:
  `import { receiving } from '@/lib/i18n/messages/receiving'`.
- Keys are dotted paths of the nested object (`t('scan.title')`), interpolation `{name}`.
- Money: `formatIls(value, { locale })` (lib/money.ts; Hebrew output unchanged). Dates/numbers:
  `formatDate / formatDateTime / formatNumber / formatPercent / formatRelative(value, locale)` from
  `@/lib/i18n/format` — **replace inline `toLocaleDateString('he-IL')` / `Intl.*('he-IL')`** in your area.
- Direction: prefer logical Tailwind utilities (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end`,
  `border-s/e`) over `ml/mr/pl/pr/left/right/text-left/right` where the layout depends on reading
  direction; directional icons (ArrowLeft as "forward" in RTL) need `ltr:-scale-x-100` /
  `rtl:` variants. Check every page you touch in BOTH `he` and `en`.
- `common` namespace (generic actions/states/units) is owned by the foundation — **don't edit it**;
  put strings in your own namespace (duplication is fine). Each namespace has exactly one owner.
- Server-thrown Hebrew error messages (tRPC) shown in your UI: map them to translated client strings
  where practical (e.g. by TRPCError code or a stable `cause`), or translate at the source if you own
  the router.

## Data for "Receiver in English" (migration 0028, already applied)

`products.name_en`, `suppliers.name_en`, `invoice_lines.raw_description_en`,
`po_lines.raw_description_en`, `memberships.preferred_locale` ('he'|'en'|NULL, CHECK-constrained).
All display-only: matching, exports and the leak math keep using the Hebrew columns.

## Ownership map (write boundaries)

| Session | Area | Owns (write) | i18n namespaces |
|---|---|---|---|
| **S1 db** | Database, migrations, RLS, seed/demo data, cutover tooling | `packages/db/**` (except 0028 already done), `apps/worker/scripts/seed-demo.ts`, `scripts/dev-setup.sh`, `docs/DB-*.md` | — |
| **S2 english-receiving** | Invoice upload → OCR → translation → receiving wizard, in English | `packages/ocr/**`, new `packages/translate/**` (if created), `apps/worker/src/jobs/ocrInvoice.ts` (+ new translate job), `packages/api/src/routers/{scans,receiving}.ts`, `apps/web/app/dashboard/{receiving,invoices}/**`, `apps/web/app/scans/**`, `apps/web/app/showcase/receiver/**`, `apps/web/lib/supabase/**` | receiving, invoices, scans |
| **S3 money-engine** | Leak/matching correctness, approvals, owner KPIs | `packages/matching/**`, `packages/charts/**`, `packages/api/src/{approvals,match}/**`, `packages/api/src/routers/{approvals,match,owner}.ts`, `apps/worker/src/jobs/matchInvoice.ts` (+ price-history writer), `apps/web/app/dashboard/{page.tsx,leaks/**,approvals/**,activity.tsx}`, `apps/web/lib/components/{LeakHeatmap,KpiCard,Sparkline,StatCard}.tsx` | overview, leaks, approvals |
| **S4 auth-admin** | Auth/2FA/login/onboarding/invite, settings, team (incl. per-member language), admin, emails, security | `apps/web/{auth.ts,auth.config.ts,middleware.ts}`, `apps/web/app/{login,(auth),onboarding,invite,admin}/**`, `apps/web/app/dashboard/{settings,team}/**`, `apps/web/lib/{authCookies,authDb,authGuards,passwords,passwordPolicy,totp,email,emailTemplates,messageTemplates,securityHeaders,sessionLifetime,safeRedirect,publicPaths,roles,env}.ts`, `packages/api/src/routers/{team,settings,onboarding,admin,plans,dsr}.ts`, `packages/api/src/{entitlements,notifications}/**`, `packages/crypto/**`, `packages/billing/**` | auth, onboarding, settings, team, admin, emails |
| **S5 ops-ui** | Day-to-day operations UI + dashboard chrome | `apps/web/app/dashboard/{layout.tsx,nav.tsx,search.tsx,worker-status.tsx,loading.tsx,suppliers/**,catalog/**,products/**,orders/**,exports/**}`, `apps/web/lib/components/**` (except S3's four), `packages/api/src/routers/{suppliers,catalog,mapping,orders,products,exports,search,activity}.ts`, `packages/api/src/{catalog,orders,exports}/**`, `packages/procurement/**`, `packages/catalog/**` | nav, suppliers, catalog, products, orders, accounting, components |
| **S6 landing** | Landing page (major upgrade), marketing pages, SEO, showcase demo | `apps/web/app/page.tsx`, `apps/web/app/(marketing)/**`, `apps/web/app/showcase/**` (except `showcase/receiver/**`), `apps/web/lib/components/CookieConsent.tsx`, `apps/web/public/**`, `apps/web/app/{robots,sitemap,opengraph-image,icon}.*`, `apps/web/app/globals.css` (append-only section), `apps/web/tailwind.config.ts` (additive) | landing, marketing, showcase |
| **S7 platform** | Build/typecheck/CI health, e2e Playwright suite, worker runtime, mobile app sanity, handoff docs | `.github/workflows/**`, `apps/web/{next.config.ts,playwright.config.ts,e2e/**,vitest.config.ts}`, `apps/worker/**` (except S2/S3 job files and seed-demo), `apps/mobile/**`, `packages/{queue,observability,types,ui-tokens}/**`, `turbo.json`, root `package.json`, `README.md`, `docs/HANDOFF*.md`, `docs/ARCHITECTURE*.md` | — |

**Shared files** (append-only, expect trivial merge conflicts the orchestrator resolves):
`packages/db/src/schema.ts` (S1 primary; others only additive with their migration),
`packages/db/drizzle/meta/_journal.json`, `packages/api/src/__tests__/cross-tenant.attack.test.ts`
(add a COVERAGE entry for every new tRPC procedure), `packages/api/src/routers/index` /
`packages/api/src/index.ts` (register new routers/exports), `apps/web/lib/i18n/messages/index.ts`
(register a new namespace only if you truly need one).

**Migration numbers** (hand-written SQL + journal entry + a shape test in
`packages/db/src/__tests__/migration-00NN.test.ts`; `when` must increase):

| Session | Numbers | `when` values |
|---|---|---|
| S1 | 0029–0034 | 1781840000000 + (N−29)·10000000 |
| S2 | 0035–0036 | 1781900000000, 1781910000000 |
| S3 | 0037–0038 | 1781920000000, 1781930000000 |
| S4 | 0039–0040 | 1781940000000, 1781950000000 |
| S5 | 0041–0042 | 1781960000000, 1781970000000 |

## Deliverables of every session

1. **Audit first** (≈30–45 min): read your area, run its tests, run the app and click through your
   pages in Hebrew and English, try edge cases. Use the existing docs (`STATE.md` "Known-wrong things",
   `docs/ARCHITECTURE-AUDIT.md`, `docs/REMAINING-SESSIONS.md`, `docs/GO-LIVE.md`) as leads, but verify
   each claim against the code — several were fixed in later commits.
2. **Fix** everything you can in your boundary, smallest-safe-change first, each fix with a test.
3. **Translate** every user-visible string in your boundary to English via your namespaces.
4. **Report** at `docs/client-ready/reports/<area>.md` (English, concise):
   - *Works* — what you verified works (and how).
   - *Fixed* — each fix: problem → fix → test (file:line).
   - *Still broken / not done* — with reason and proposed fix.
   - *Feature & improvement proposals* — ranked by client value / effort.
   - *Immutable files touched* — with justification.
   - *Needs another area* — precise asks for other sessions.
   - *Gate* — the exact commands you ran and their results (tests, typecheck, build).
5. Gate before your final push: your packages' tests green, `pnpm test` green, web `tsc` 0 errors,
   `pnpm build` green if you touched `apps/web`. Then push and open the draft PR into
   `claude/client-ready`.
