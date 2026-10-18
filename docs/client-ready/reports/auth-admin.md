# S4 — auth-admin report (client-ready sprint)

Branch `claude/client-ready-auth-admin` → draft PR into `claude/client-ready`.
Scope: login / magic link / 2FA / lockout / reset / set-password / invite → accept / onboarding /
roles / sign-out / session revocation, Settings, Team (incl. per-member language), `/admin`,
auth emails, security review.

## Works (verified)

Verified end-to-end in Chromium against `next dev` + the seeded demo tenant with a scripted
Playwright run (every check below passed, in the language noted):

| Flow | Verified |
|---|---|
| Access matrix, all 5 roles × 9 routes | owner/manager/receiver/bookkeeper/chef land on `/dashboard`; Settings reachable by all; Team owner+manager; Exports/Receiving per `ROUTE_ROLES`; `/admin` 404 for non-admins |
| Password | set-password → success banner; wrong password → one uniform error (EN); password login → dashboard |
| Reset | request → "sent" (no enumeration); emailed link → new password → `/login?reset=1` banner; re-using the token → `error=token` |
| 2FA | enrol (QR secret + TOTP) → 10 recovery codes; magic-link login → `/login/2fa`; a pending session hitting `/dashboard/team` is bounced **with `callbackUrl`**; wrong code rejected; correct code → back to `/dashboard/team`; recovery code works; disable with a recovery code |
| Invite → accept | owner (Hebrew UI) invites with language *English* → link carries `lang=en` → invitee's login page is English, email locked → magic link → accepted → dashboard in English |
| Per-member language | manager sets receiver → English on Team; receiver on a **new device** (no cookie) gets English and `rm_locale=en` is written; receiver switches back to Hebrew from Settings |
| Onboarding | brand-new user → `/onboarding` (he + en) → creates restaurant → dashboard |
| Sign-out everywhere | second device is revoked on its next request |
| Magic-link throttle | 4th request in 15 min → translated "could not send" message on `/login` (was a bare English `/api/auth/error` page) |

## Fixed

| # | Problem | Fix | Test |
|---|---|---|---|
| 1 | **Every English page rendered RTL**: `globals.css` set `html { direction: rtl }`, which overrides `<html dir="ltr">`. | Removed the declaration; direction comes from the root layout's `dir`. (S6's file — one line, flagged below.) | live: `auth-*-en.png` |
| 2 | Receiver/chef/bookkeeper/manager could not reach Settings at all → no 2FA, no password, no DSR for them. | `ROUTE_ROLES['/dashboard/settings'] = ALL_ROLES`; personal sections for everyone; restaurant sections owner-edit / manager+bookkeeper read-only / hidden for receiver+chef. | `apps/web/lib/__tests__/roles.test.ts` |
| 3 | `/set-password` and "log out everywhere" existed but were linked from nowhere. | New "My account" section in Settings (language, password set/change, sign out of all devices). Set-password lands on a success banner instead of a silent `/dashboard?password=set`. | live flow |
| 4 | `/login?reset=1` showed nothing after a successful reset. | Success banner (+ `signedOut=1` banner). | live flow |
| 5 | Throttled magic link → Auth.js bare English error page; inline-action `signIn` errors not mapped. | `pages.error = '/login'` + `Configuration`/`EmailSignin` → translated message. | live flow |
| 6 | 2FA step dropped the destination — an invite link through 2FA never got accepted. | Middleware forwards `callbackUrl` to `/login/2fa`; page + action re-validate with `safeRelativePath`. | live flow (`callbackUrl=%2Fdashboard%2Fteam`) |
| 7 | **DSR "delete my account" left the session alive** (JWT sessions — deleting `sessions` rows revokes nothing) and kept the argon2 hash + TOTP secret + recovery codes. | `dsr.deleteMyAccount` bumps `token_version` and wipes credential material, recovery codes, reset tokens; UI then signs the device out. | `packages/api/src/__tests__/dsr.test.ts` ("revokes live JWTs…") |
| 8 | `updateMemberRole` delete+re-insert would wipe a member's language. | Preserves `preferred_locale`. | `team-locale.test.ts` |
| 9 | Server-thrown Hebrew errors shown raw in English UI; raw `Required role: …` dev strings shown to users. | `apps/web/lib/serverErrors.ts` maps each known router message / prefix code / tRPC code to translated copy; unknown Hebrew never leaks into English. | `apps/web/lib/__tests__/serverErrors.test.ts` |
| 10 | Invite email preview double-escaped (`&amp;amp;`). | Plain text into `renderEmail` (which escapes once). | `templates.test.ts` |
| 11 | No throttle on invite/resend emails (owner account usable as a spam relay). | 20 invite emails / inviter / hour (Redis limiter, fails open), translated message. | manual (see Gate) |
| 12 | Admin layout hard-coded `dir="rtl"`; raw JSON overrides; `toLocaleString('he-IL')` ₪; no KPIs/empty-state hints. | Locale-aware layout + switcher, KPI strip, readable overrides, member names + EN badge, lead email/phone links + consent state, `formatIls`/`formatDate`, empty states. Also `/admin` login keeps `callbackUrl`. | screenshots |
| 13 | Onboarding: no way out / no hint for invitees, Hebrew-only validation. | Sign-out + language switcher, invitee hint, translated client validation. | live flow |

### New features
- **Per-member app language** — `team.setMemberLocale` (owner+manager, tenant-guarded), `settings.myLocale` / `settings.setMyLocale` (self), `team.list` now returns `preferredLocale` and is readable by managers (writes remain owner-only). COVERAGE entries + real attack assertions in `cross-tenant.attack.test.ts` (foreign userId → NOT_FOUND and B untouched; receiver/bookkeeper/chef → FORBIDDEN; self-only writes).
- **Invite in the invitee's language** — migration **0039** `invitations.preferred_locale` (CHECK he|en, shape test `migration-0039.test.ts`); copied onto the membership at accept; invite email + login link (`lang=en`) in that language.
- **`LocaleSync`** (`apps/web/app/dashboard/locale-sync.tsx`, 2-line mount in S5's `layout.tsx`): a device with no `rm_locale` adopts the member's saved language once. A device that chose a language is never overridden.
- **Emails**: magic-link + reset emails follow the requester's `rm_locale`; invite email follows the invitee language (LTR English frame, translated footer).
- Translations: namespaces `auth`, `onboarding`, `settings`, `team`, `admin` fully populated (the `emails` namespace stays empty — email copy is localized at the source in `packages/api/src/notifications/templates.ts`, shared with the worker). `labelForRole(role, locale)` / `roleLabels(locale)` added to `lib/roles.ts` (back-compatible).

## Still broken / not done

- **Implicit trial = all features forever** (`getEntitlements`: no billing account ⇒ trial, never expires). Risk: any self-onboarded restaurant gets Pro features and unmetered OCR indefinitely. **Proposed fix** (not applied — billing/entitlements change mid-demo, and would affect the demo tenant): bound the implicit trial to `restaurants.created_at + 30 days`, then `active=false`; exempt tenants with an explicit `restaurants.settings.demo = true` (set by the seed) or an `IMPLICIT_TRIAL_UNBOUNDED_IDS` env allowlist; show "trial ends in N days" in `/admin` (the column exists). ~1 h + tests.
- **CSP still Report-Only** (`CSP_ENFORCE` unset) — intended; promote after a soak (GO-LIVE Phase 8).
- **`TRUSTED_PROXY_HOPS` defaults to 0** (left-most XFF). Every credential surface already passes `trustedProxyHops()` (STATE.md's "S3" item is done). On Vercel the XFF is set by the edge, so impact is low; recommend `TRUSTED_PROXY_HOPS=1` in Vercel env (owner step).
- **Magic-link limit is 3 per mailbox per 15 min** — easy to hit while rehearsing a demo. Use password login for the demo (S1 is adding seed passwords) or `redis-cli flushall` locally.
- Server errors are mapped client-side by their Hebrew text; a stable error-code field on `TRPCError` (errorFormatter in `trpc.ts`) would be cleaner long-term.
- Invite throttle has no automated unit test (server action needs an auth mock); verified live (21st invite in the hour → "Too many invites…").

## Feature & improvement proposals (client value / effort)

1. **Demo password + "demo login" buttons on `/login` in dev/preview** — zero-friction demo (S1 seed + S4 page). High / S.
2. **Bounded implicit trial** (above). High (revenue integrity) / M.
3. **Language column + "resend in English"** on pending invites, and invite language defaulting to the inviter's current UI language. Medium / S.
4. **Active sessions list** (device, last seen) using `token_version` + a session-log table. Medium / M.
5. **Admin: impersonate (read-only) a tenant** for support, audit-logged. Medium / M.
6. **Admin: lead → restaurant conversion** (create tenant + invite owner from a lead row). Medium / M.

## Immutable files touched

- `packages/db/src/schema.ts` — additive `invitations.preferredLocale` column for migration 0039 (shared file, append-only).
- `packages/db/drizzle/meta/_journal.json` — 0039 entry (`when` 1781940000000, `idx` 39).
- `packages/api/src/__tests__/cross-tenant.attack.test.ts` — 3 COVERAGE entries + 4 attack/isolation tests (additive, nothing weakened).
- `packages/api/src/notifications/templates.ts` (outbox-adjacent; in my boundary) — `locale` option for the 3 auth emails; Hebrew output unchanged.
- `apps/web/lib/rateLimit.ts` — **not** modified (the invite limit lives in `team/actions.ts`).

## Shared / other-area files touched (minimal)

- `apps/web/app/globals.css` (S6) — removed `direction: rtl` on `html` (fix #1). Critical for every English page.
- `apps/web/app/dashboard/layout.tsx` (S5) — import + `<LocaleSync />` mount (as allowed by the brief).
- `packages/api/src/audit.ts` — two `AuditAction` union members (`team.member_locale_changed`, `settings.my_locale_changed`).
- `packages/api/src/index.ts`, `notifications/index.ts` — export `EmailLocale` type.

## Needs another area

- **S1 (seed)**: flag `owner@kfar-hazeitim.test` as `is_platform_admin` (STATE.md says it is; the current seed leaves it `false`, so `/admin` 404s for the demo owner). I set it by SQL locally for screenshots.
- **S5 (layout/nav)**: pass the locale to `labelForRole(active.role, locale)` in the header and translate "התנתק"; nav now shows Settings to all roles and Team to managers (driven by `ROUTE_ROLES`).
- **S1/S7**: `next dev` hot reload re-creates the postgres pools in `lib/db.ts`/`lib/authDb.ts` and exhausts `max_connections` after many edits ("sorry, too many clients already") — cache the clients on `globalThis` in dev.
- **S6**: the cookie-consent banner is Hebrew-only on English pages.
- **S2**: entitlement quota messages (`QuotaExceededError`) are Hebrew; `localizeServerError` already maps "subscription inactive" — use it in the scan UI.

## Gate

All run in this container (Postgres 16 + pgvector, Redis), with the dev server **stopped** (it holds
Postgres connections; with it running the api suite hits `too many clients already`).

```
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/restomatch_test pnpm test
  → Tasks 12/12 successful · db 19 · crypto 12 · billing 5 · procurement 17 · ocr 39 · charts 18 ·
    catalog 50 · matching 76 (leak-canary untouched) · api 399 · worker 9 (+1 skipped) · web 143
pnpm --filter @restomatch/web exec tsc --noEmit -p .        → 0 errors
cd apps/web && set -a && . ./.env.local && set +a && pnpm build → ✓ Compiled successfully
  (one earlier attempt failed fetching Google Fonts — transient network; the retry was green)
Playwright flow script (scratchpad, against next dev)        → every check in "Works" PASS
```

**After merging `origin/claude/client-ready` (S1 + S3 + S6, a35f265):** `pnpm test` → 12/12 tasks, 849 tests
(db 45 · api 412 · web 148 · matching 86 · charts 26 · …), web `tsc` 0 errors, `pnpm build` green.

> ⚠️ **Migration-order pitfall for the orchestrator:** drizzle's migrator only applies journal entries
> whose `when` is newer than the last applied one. A database that already ran a session branch with a
> higher number (e.g. my 0039) **silently skips** later-merged lower numbers (S1's 0029–0032), and
> `db:doctor` / the 0029–0032 shape tests then fail. Fix on such a DB: delete the high-number rows from
> `drizzle.__drizzle_migrations` (all session migrations are idempotent) and re-run `migrate`, or
> rebuild with `./scripts/dev-setup.sh`. Production applies them in one ordered run, so it is unaffected.

Focused suites added/extended: `packages/db/src/__tests__/migration-0039.test.ts`,
`packages/api/src/__tests__/team-locale.test.ts`, `cross-tenant.attack.test.ts` (member-locale block),
`dsr.test.ts` (JWT revocation + credential wipe), `notifications/__tests__/templates.test.ts` (English
auth emails, single escape), `apps/web/lib/__tests__/roles.test.ts`, `apps/web/lib/__tests__/serverErrors.test.ts`.

Screenshots: `docs/client-ready/screenshots/auth-{login,reset,2fa,onboarding,set-password,settings-owner,settings-receiver,team,admin,admin-restaurant,admin-leads}-{he,en}.png`
(not every page in both languages: 2FA is he only, receiver settings is en only).
