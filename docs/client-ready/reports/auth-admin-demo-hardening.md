# S4: auth/security hardening for the 2026-10-25 demo

Branch `claude/client-ready-auth-admin`, PR #56 into `main`.

## Shipped

| Commit | What |
|---|---|
| db7bc63 | **`apps/web/lib/publicGuard.ts`**: one front door for public route handlers that need no login (S11 supplier link, S13 webhooks, S15 leak check). 14 tests. |
| 2fe9d4c | **Authz: the chef could open supplier invoices.** Fixed in the route rule and the API. |
| ~~d8877c9~~ | **Sign-out could leave the user signed in.** The Redis-backed fix was **reverted in df9b968** (Redis is being removed). It returns on Postgres (migration 0060) in a separate PR after #56 merges. |

### publicGuard

`guardPublicRequest(req, opts)` runs these checks in order:

1. method allow-list → 405
2. optional same-origin check → 403
3. Content-Length pre-check → 413
4. per-client rate limit through the existing `enforceRateLimit` (`rateLimit.ts` is imported, not edited) → 429 with Retry-After
5. **streamed** body read with a hard byte cap → 413
6. JSON.parse → 400
7. zod `safeParse`, only after the cap → 422 (field paths only)

Notes:

- The cap is counted on the bytes actually read. A chunked body or a lying Content-Length never reaches zod, and a test covers this. That is what the GHSA-mrhx-c7xc-m3w5 exception relies on.
- The cap counts bytes, so Hebrew text is measured correctly.
- `rawBody` is returned for webhook HMAC checks.

### Invoice authz

`/dashboard/invoices/[id]` had no `ROUTE_ROLES` rule, so it fell through to `/dashboard`, which every role may open.

- Global search showed invoices to the chef, because `canSee` defaulted to true.
- `receiving.getInvoice` and `ensureEnglish` were `memberProcedure`, so the API allowed the chef too.
- The 10-18 role matrix had already recorded `chef | /dashboard/invoices/:id | RENDER`.

The route rule and the new `invoiceReaderProcedure` now allow owner, manager, receiver and bookkeeper. The receiver's receiving wizard keeps working, and `/scans/:id` is a 404 for the chef.

### Sign-out revocation (reverted in df9b968; returns on Postgres)

**Symptom.** On a production build, 2 of 8 sign-outs (in both he and en) left the user in: `/dashboard/leaks` still rendered.

**Cause.**

- Every authenticated response re-issues `authjs.session-token`, because the JWT is rolling.
- A request still in flight when the user clicked sign-out (a link prefetch or a tRPC query) could land after the sign-out response.
- It re-planted the still-valid JWT, because sign-out only deleted this browser's cookie.

**Fix.**

- Each JWT carries a random `sid`. It is stamped at sign-in; existing tokens get one on their next request.
- `events.signOut` deny-lists the `sid` in Redis (process-local without `REDIS_URL`) for the session lifetime.
- The node jwt callback empties any token whose `sid` is deny-listed.
- Only that one session ends; the user's other devices stay signed in. `token_version` ("log out everywhere") is unchanged.
- The check fails open on a Redis outage, with a 300 ms deadline.

**Result.** 20/20 sign-outs went to `/login`, including 3 where the cookie had been re-planted and is now rejected. A second device stayed signed in.

## Auth QA on a production build

Setup: `next build` + `next start`, NODE_ENV=production, local Postgres/Redis, seeded with DEMO_TODAY=2026-10-25.

| Suite | he @1366 | he @390 | en @1366 | en @390 |
|---|---|---|---|---|
| Auth flows (48 checks)¹ | 47 + 1 by design² | 47 + 1 by design² | 48/48 | 48/48 |
| Role matrix, 5 roles × every dashboard page | guards = ROUTE_ROLES | same | same | same |
| 5xx | 0 | 0 | 0 | 0 |
| Console errors | 0 | 0 | 0 | 0 |

¹ The auth-flow checks cover: password (incl. the uniform error); sign-out; remember-me; token_version revocation; magic link; reset; 2FA enrol / verify / recovery / disable; invite; role change + per-member language; admin panel; `?lang`; CSP headers; rate limits for login, magic link and invite.

² "Chef now sees English UI" fails only because the harness sets `rm_locale=he` on the device. `LocaleSync` adopts the member's saved language only when the device has never chosen one; that is intended.

Role matrix details:

- The chef sees `/dashboard` and `/dashboard/settings` only.
- The receiver sees `/dashboard`, receiving, invoices and settings.
- The bookkeeper sees `/dashboard`, approvals, exports, invoices, leaks and settings.
- Every other page bounces to `/dashboard`, and `/admin` is a 404 for non-platform admins.
- There are no crashes, no `lang` mismatch, and no horizontal scroll at 390.

**Harness fixes, not app bugs:**

- 2FA button names are matched in both languages.
- The recovery-code regex now matches only the real code shape. The old one also matched English nav words like "Approvals".
- Mobile sign-out goes through the drawer.
- The invite rate-limit check saturates the owner's exact hourly key. Before, it scanned `*invite*`, which also matched a `magiclink:qa-invitee…` key.

## Seen, not fixed here

- **Cookie banner at 390 on `/login`.** It covered the "Email me a sign-in link" button, and the page was too short to scroll clear of it. That was S6's file. `main` @ 388ec2f has since changed the banner ("never covers…"), so I re-check it on the merged build.
- **React #418 hydration error.** It showed once in about 400 page loads, around `/dashboard/leaks/report` for the receiver in en (and once on 10-18). It did not reproduce in 120+ targeted loads; it's probably a time-dependent render. Logged, not fixed.
- **Heebo font preload warnings.** "Preloaded but not used" appears on some pages. These are console warnings, not errors.
- **Repo E2E runs on `next dev`.** `playwright test` runs on `next dev --turbopack`, not the production build, and it overwrites `apps/web/.next`. Run `rm -rf apps/web/.next` before `verify.sh layer2` if you ran Playwright on its own.
