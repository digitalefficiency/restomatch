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
- Invite throttle has no automated unit test (server action needs an auth mock); verified live (21st invite in the hour → "Too many invites…").

## Follow-up round — stable error codes

- `packages/api/src/errors.ts`: `APP_ERROR_CODES` (22 codes), `appError(code, appCode, message, params?)`
  and `resolveAppError(error)`. Every known domain error in team / onboarding / settings (zod
  `params.appCode`) / dsr / admin now throws an `appError`; quota (`QuotaExceededError` → `subscription.inactive`
  / `quota.exceeded` + `{limit}`), `ENTITLEMENT_REQUIRED:<feature>` → `entitlement.required`, role/auth →
  `auth.forbidden` / `auth.unauthorized`, other zod → `input.invalid`. Messages are unchanged.
- `trpc.ts` `errorFormatter` exposes `data.appCode` + `data.appParams` (null when uncoded).
- Web `lib/serverErrors.ts` translates by `data.appCode` (HTTP) or `cause.appCode` (server caller)
  first, through an **exhaustive** `Record<AppErrorCode, key>` (a new server code without a translation
  is a type error); the Hebrew-text mapping stays as the fallback (and its quota mapping now carries the limit).
- Tests: `packages/api/src/__tests__/app-error-codes.test.ts` (unit + real fetch-adapter HTTP shape),
  `apps/web/lib/__tests__/serverErrors.test.ts` (code path, cause path, params, unknown code → fallback).
- Entitlement/trial semantics unchanged (still a proposal above).
- Gate: `pnpm test` 12/12 tasks (api 420, web 154, db 45, matching 86 …), web `tsc` 0, `pnpm build` green.

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

---

## Round: F4/F5/F6 + full auth/roles/security QA on the RC (b5334f6)

Priority per the final-review triage: F4 is a hard boot failure; F5/F6 are **WARN-level** only.

### Fixed
| # | Sev | What | Where | Test |
|---|---|---|---|---|
| F4 | med | Prod boot fails without `AUTH_SECRET` (or `NEXTAUTH_SECRET`, which Auth.js v5 also reads); an empty value counts as missing | `apps/web/lib/env.ts` | `env.test.ts` |
| F5 | low | WARN (never throw) when `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` is not `https://<ref>.supabase.co`, and when the DB URLs' ref differs from the Supabase URL's ref (logs `KEY=ref` only, never hosts/passwords) | `env.ts` `webEnvWarnings` | `env.test.ts` |
| F6 | low | WARN when the `APP_URL` and `AUTH_URL` origins differ; ENV doc: open the demo **only on `AUTH_URL`** (AUTH rows only) | `env.ts`, `docs/ENV-PRODUCTION.md` | `env.test.ts` |
| Q1 | **med** | **Invitee session kept `role=null` in its cookie for its whole life**, because the session was minted before the membership existed and an RSC can't rewrite cookies. So the middleware role gate never applied to a new invitee; only page/procedure guards did. Invite accept now redirects through `/api/session/refresh` (`unstable_update` → membership re-query, same-origin `next` only). Verified on the prod build: the cookie carries `role=chef` and `/dashboard/suppliers` gets an HTTP bounce. | `app/api/session/refresh/route.ts`, `app/invite/accept/page.tsx` | `route.test.ts` (refresh, open-redirect, signed-out) |
| Q2 | med | Regression in this round's own schema: `AUTH_SECRET=''` / `SUPABASE_URL=''` was a zod parse error that would brick **dev** boot too. Now `''` = unset. `NEXTAUTH_URL` satisfies the URL requirement. | `env.ts` | `env.test.ts` |

### QA (production build: `next start`, NODE_ENV=production, local Postgres/Redis only)
Harness: a scratchpad-only `--require` preload swapped `api.resend.com` for a local JSON sink and logged any non-localhost egress. **Zero real emails sent; zero external requests.** The production email code was not changed (the E2E sink stays a proposal). Separate DB `restomatch_qa` (prepared like `e2e/prepare-db.ts`).

| Area | Result |
|---|---|
| Password login: wrong password / unknown email → same `CredentialsSignin` | ✅ |
| Session cookie httpOnly + SameSite=Lax; remember-me 30d, otherwise 1d | ✅ |
| Logout → dashboard needs login again | ✅ (4/4 isolated; one suite flake was the harness navigating before the action finished) |
| Revocation (`token_version` bump) → next request goes to /login | ✅ |
| Session expiry (server-signed JWTs with an old `loginAt`): 25h not-remembered → out; 25h remembered → in; 31d → out | ✅ |
| Magic link: sent to the sink, logs in, single-use (`?error=Verification` on reuse) | ✅ |
| 2FA: enrol (wrong code rejected, 10 recovery codes, persisted) → pending session gated → TOTP keeps the callbackUrl → recovery code works → reused recovery code rejected → disable with a current code | ✅ |
| Invite: email in English for an `en` invite (only the tenant name is Hebrew), link has `lang=en` + callbackUrl, invitee login/magic link in English, accept → role chef + locale en, English UI, team page blocked | ✅ |
| Team: owner changes a role; manager is read-only but sets a member's language → that member sees English | ✅ |
| Admin: allowlisted owner sees /admin, restaurant detail and leads; every other role gets 404 | ✅ |
| Role × page matrix: 5 roles × 25 routes (all /dashboard pages + /scans + /admin) | ✅ No 5xx anywhere; every route outside ROUTE_ROLES bounces to /dashboard |
| Rate limits: login (Redis 10/15min per email + 30/IP, uniform error; DB lockout after 5 blocks even the right password); magic link (3/15min, 4th → friendly message, only 3 mails); invite (21st/hour → "too many invites", no mail) | ✅ |
| CSP: `Content-Security-Policy-Report-Only` (nonce) on public pages; **0 CSP violations** on 12 public pages × he/en and on all dashboard pages × 5 roles | ✅ |
| `?lang=`: en → cookie + LTR; persists; invalid value ignored; he → RTL | ✅ |
| Boot guard (with `.env.local` moved aside, since `next start` loads it): each of AUTH_SECRET, DATABASE_URL_APP, RESEND_API_KEY, EMAIL_FROM, REDIS_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_ENC_KEY missing → every route 500 with a `[env] missing required production secrets` log naming it. AUTH_URL **or** APP_URL alone is enough (by design) | ✅ |

### Findings not fixed (proposals / other areas)
- **Least privilege (medium, needs a product call):** `/dashboard/invoices/[id]` and `/dashboard/products(/[id])` render for **chef and receiver**. They are backed by `memberProcedure` (`receiving.getInvoice`, `products.list`, `catalog.productDetail`), which return invoice totals and VAT, billed unit prices and price history. Writes are manager-only. Receivers need invoice detail for receiving; chef arguably doesn't need prices. Proposal: a `receiverProcedure` tier or price redaction for chef, plus ROUTE_ROLES entries. Not changed on demo eve because it changes role semantics.
- **Low:** calling `team.invite`/`team.resendInvite` directly over `/api/trpc` skips the 20/h limit, which lives in the server action. No email goes out on that path (email is sent only by the action), but it allows unlimited invitation and audit rows. Fix: `PER_PROCEDURE_LIMITS` in the immutable `app/api/trpc/[trpc]/route.ts` → needs a human PR.
- **Low:** any role can call `receiving.ensureEnglish`, which may trigger paid translation (already capped/cached from the S2 pass). A tier tightening could go with the item above.
- **Low (log noise):** a non-admin hitting /admin gets a correct 404, but the page's parallel `adminProcedure` call logs `⨯ TRPCError: platform admin only`.
- **Needs another area:** an intermittent React hydration error #418 in the prod build, seen once on `/dashboard/catalog/import` and once on `/dashboard/leaks/report` (plus `parentNode` null). It's not tied to one page, so it's likely a shared component. The page recovers.

### Verification (2 layers)
- **Layer 1, full gate:** `pnpm test` (turbo, all packages), web `tsc --noEmit`, web lint (0 errors), `next build`. Results under "Gate (this round)".
- **Layer 2:** (a) the production build + Playwright click-through above: 47 auth checks, 125-cell role matrix, 4 expiry checks, 24 public-page loads, boot-guard matrix. (b) An **independent refuter subagent** attacked each claim. It confirmed F4 (Auth.js reads `NEXTAUTH_SECRET`) and the rate limits, and refuted / added: the null-role invitee cookie (→ Q1 fixed), the empty-string regression (→ Q2 fixed), the unreachable "neither URL" warning (removed), the chef/receiver price visibility and the direct-tRPC invite path (→ proposals above).

### Gate (this round, final head)
- `pnpm test`: 13/13 turbo tasks; **1,102 passed**, 1 skipped (worker); web 212 (was 207 + 5 new).
- web `tsc --noEmit`: clean. Web lint: 0 errors (9 pre-existing-style warnings). `next build`: ✅ (includes `/api/session/refresh`).

### Immutable files touched
None. (`cross-tenant` COVERAGE untouched: no new tRPC procedure.)

### Cross-QA: S8 chain / branch switcher (PR #38, `claude/client-ready-chain` @ 6fb058a)
I built the branch as a production build and ran it against a chain-demo seed: the owner has 3 branches, and the manager was set up as manager on the main branch and chef on Jerusalem. The checks used forged requests via Playwright `request`.

| Check | Result |
|---|---|
| Forged `POST /api/auth/session {activeRestaurantId: <branch I'm not a member of>}` | ✅ ignored (stays on the current branch and role) |
| `chain.switchTarget(<foreign>)` | ✅ 404 "branch not found" |
| `chain.overview` / `renameBranch` / `addBranch` as a non-owner | ✅ 403 |
| Manager → `/dashboard/chain` | ✅ bounced |
| Switch to an own branch where the role is lower (manager → chef) | ✅ the session is re-issued with **that branch's role**; the edge gate uses it (`/dashboard/suppliers` → HTTP bounce); manager-tier writes → 403 |
| `token_version` bump after a switch | ✅ next request → /login |
| Owner switches to Haifa | ✅ session `owner@Haifa`, `/dashboard/chain` 200, header shows the branch |
| Garbage `activeRestaurantId` | ✅ ignored |
| #38's `chain.attack` + `cross-tenant` + `rls.attack` suites | ✅ 183/183; `activeRestaurant.test.ts` 6/6 |

Code review: the requested branch is honoured only if it is in the DB memberships (`pickActiveMembership`). It runs after the `token_version` check, and the 2FA gate still clears only via the server-verified ticket. Cross-branch reads run in each branch's own `withRestaurant` RLS transaction, and `addBranch` checks the billing-account payer and takes an advisory lock. **No findings.** One note for merging with this PR: `/api/session/refresh` calls `unstable_update({})`, which carries no `activeRestaurantId`, so it keeps the current branch.

#### Cross-QA #38, second pass (orchestrator's list; chain head 6fb058a ⊇ 8bd32da)
Adversarial seed: **RIVAL**, a restaurant on the *same billing account*, owned by chef@. The chain owner is only a *manager* there. The price-disparity flag is on.

| Check | Result |
|---|---|
| `chain.overview` / `chain.branches` as owner | ✅ only the caller's **owner** branches; RIVAL is absent even though it shares the billing account |
| Price-disparity panel | ✅ rows come only from own branches (each read under its own `withRestaurant` RLS) |
| Owner switches to RIVAL (manager there) | ✅ role becomes manager; `chain.overview` 403, `renameBranch(RIVAL)` rejected |
| CSRF: captured real `switchBranchAction` POST, replayed with `Origin: https://evil.example` | ✅ rejected (500, Next's server-action origin check), session unchanged. A same-origin replay works (control) |
| `addBranch` ×6 in parallel (limit 5, 4 existing) | ✅ exactly 1 succeeds, 5 get 403. The advisory lock holds |
| `addBranch` by a co-owner who is not the payer | ✅ 403. ⚠ low (UX): the error is `ENTITLEMENT_REQUIRED:chain`, so a non-payer sees an upsell, not "only the payer can add branches" |
| Membership removed while active on that branch | ⚠ **pre-existing design, not #38:** tenant data is still served until the 10-min membership re-check (`MEMBERSHIP_REVALIDATE_MS`), because RLS trusts the JWT's restaurant id. Any session update (a switch, `/api/session/refresh`) drops it immediately, and switching back is refused |
| Stale JWT carrying an old active restaurant | ✅ re-validated off that restaurant once the cache stamp is older than 10 min. A JWT with a fresh stamp is trusted for that window, which needs `AUTH_SECRET` to forge, so it isn't an attacker capability |
| Interplay with `/api/session/refresh` | ✅ `unstable_update({})` keeps the current branch, and also drops a removed one |

Proposal (not fixed; it's in the shared auth/team code): on member removal or role change, bump a per-user membership epoch (or `token_version` for the removed user) so the 10-min window closes immediately.

### Cross-QA: S15 wave-1 growth (PR #44, `claude/wave1-growth` @ eff9961)
Tested on a production build (`next start`, NODE_ENV=production) against a local DB. OCR used the stub (`LEAK_CHECK_ALLOW_SAMPLE=1`), so there was zero Claude spend. `TRUSTED_PROXY_HOPS=1` was set, and distinct client IPs were simulated via the right-most XFF entry. #44's own suites pass: api 142/142, web 43/43.

**Findings (fixes go back to S15)**
| # | Sev | Finding | Fix |
|---|---|---|---|
| W1 | **medium** | The site-wide 40/h submit cap is consumed **before** the proof of work is checked (`handlers.ts`: `enforceRateLimit('all', …)` runs before `verifyPow`). Verified: 40 junk POSTs with no solved PoW (8 IPs × 5, under the per-IP limit) → the next real prospect gets `503 budget_exhausted` for the hour. The lead magnet can be shut off with zero work. | Move the global cap after `verifyPow` + the single-use check (ideally right before `runLeakCheck`) |
| W2 | low (defence in depth) | The migrations' `REVOKE ALL ON leak_check_sessions/leak_check_ocr_usage FROM restomatch_app` and `REVOKE UPDATE, DELETE ON referral_*` are **undone by `provision-rls`'s blanket grants** (it runs after migrate). Isolation still holds via RLS default-deny (verified: 0 rows visible, INSERT rejected, UPDATE/DELETE affect 0 rows, credits can't be minted). But it's one layer, not the intended two. | Exclude/re-revoke these tables in `rls.ts`' grants (immutable → human PR), or re-assert the revoke in `provision-rls` |
| W3 | low (hygiene) | The PR modifies the committed **`dump.rdb`** (a Redis snapshot: rate-limit/session keys). It was ruled never-commit earlier. | Drop it from the PR; `git rm --cached` + `.gitignore` |
| W4 | low | The 7-day hard delete only runs on the next submit. With no traffic, expired rows persist (reads filter on `expires_at`, so they're never served). | Schedule `purgeExpiredLeakChecks` (already a tracked follow-up) |

**Verified ✅**
- Foreign/no Origin → 403.
- Gate off (`LEAK_CHECK_PUBLIC` unset) → page + API 404.
- `TRUSTED_PROXY_HOPS=0` in prod → 503 fail-closed.
- Chunked body → 411. A real 9 MB body → 413 in 34 ms, before parsing.
- Text named `.pdf` → 415 (magic bytes). A >4 MB file → 413. 11 files → 400. 0 files → 400. Honeypot → fake success, nothing stored.
- PoW: replayed / forged / unsolved / expired / low-difficulty (server-signed) → 403.
- Per-IP 5/day (6th → 429). Per-email 3/day, with `+tag` aliases counted as the same mailbox.
- Daily OCR budget (cap 3: 2 invoices OK, the next 2 → 503).
- Signed result links: a swapped session id, an extended exp, a bad signature or an expired link are all rejected **identically** (same page, no data). A valid link shows only its own session.
- Tenant role cannot see sandbox rows. An expired session is hard-deleted on the next submit.
- Lead route: tampered → 400, foreign origin → 403, the same token twice → one lead row.
- Claim:
  - GET changes nothing.
  - An email mismatch → failed.
  - A cross-origin server-action replay → rejected. A cross-origin tRPC call → 403.
  - A matching owner → claimed to their own restaurant.
  - Another restaurant can't re-point it.
  - The claimed list is tenant-scoped.
  - A tampered token → `BAD_REQUEST` with only `appCode: leakCheck.invalidLink` + a Hebrew message, no stack/SQL.
- Referral: own code → `referralSelf`; unknown → `referralInvalid`; a second redeem → `referralAlreadyRedeemed`; a restaurant >30 days old → rejected; a shared member → self-dealing blocked; an A↔B swap → blocked; the referred side sees `pending` with no credit; a pre-credited INSERT → RLS violation; a tenant sees only its own code.
- `publicPaths` adds only `/leak-check` and `/api/leak-check` (prefix match is segment-bounded). Every route re-checks the gate, origin, limits and PoW; the claim page itself requires a signed-in owner.

Accepted / by design: a sock-puppet referral from a second mailbox is possible, but credits fill only on conversion (payment). Prospect email is unverified at submit, but claiming requires signing in with that email.

### Cross-QA: S17 recipes / food cost (PR #46, `claude/wave1-recipes` @ 5993028)
Tested on a production build against a local DB with the recipes demo seed, plus a RIVAL tenant holding a product and a sub-recipe. #46's suites (cross-tenant, rls.attack, recipes-router, recipes-cost) pass 205/205.

**Finding (fix goes back to S17)**
| # | Sev | Finding | Fix |
|---|---|---|---|
| R1 | low-medium | **Concurrent sub-recipe saves that would close a cycle → HTTP 500.** Reproduced 8/8: X→Y and Y→X saved at the same moment. Postgres reports `deadlock detected` on the composite-FK row locks, one save wins and the other returns a generic `INTERNAL_SERVER_ERROR`. No cycle was ever persisted, and `recipes.list` stays fast (cost is memoised and marks cycles), so there's no DoS. But the protection is **incidental** (lock ordering), not the cycle check, and the user sees a 500. | Serialize recipe-graph writes per restaurant: `pg_advisory_xact_lock(hashtext('recipes:'||restaurant_id))` at the start of `save`/`importCsv`. The cycle check then sees committed edges and returns the friendly `recipes.cycle` |

**Verified ✅**
- **Roles:** owner/manager/chef can list and edit, and the page renders. Receiver/bookkeeper get 403 on the API and bounce from the page. `setTarget` is owner/manager only (chef 403).
- **Cross-tenant references:** blocked at every layer.
  - API: save with another restaurant's product → `productNotFound`; with its sub-recipe → `subRecipeNotFound`. get/delete of a foreign recipe → 404, with no effect. `searchProducts` never returns another tenant's products.
  - DB, as the app role: the composite same-tenant FK rejects a foreign `product_id`. RLS hides other tenants' recipes and rejects an INSERT into another tenant.
- **Cycles:** A→B→A and A→A rejected on save (`recipes.cycle`). CSV P↔Q rejected with nothing written.
- **Feature flag off:** `FEATURE_DISABLED:recipes` (403, appCode only), and `recipes.enabled` = false.
- **products.delete guard:** deleting a product a recipe uses → friendly 409, product kept. A foreign product → 404. Deleting a sub-recipe that's in use → `recipes.inUse` 409.
- **CSV import:**
  - >200 KB → 400 before parsing; 2001 rows → `tooManyRows`.
  - A decimal comma `"1,5"` → `badQuantity` (never 15).
  - An ingredient named like another tenant's product doesn't resolve to it.
  - A formula-like name (`=HYPERLINK(…)`) is stored as plain text; there's no CSV export, and React escapes it on display. Note: neutralize leading `= + - @` if a recipe export is ever added.
- **COVERAGE:** all 11 `recipes.*` procedures listed (attack/isolation).
- **Error bodies:** no SQL/stack.
