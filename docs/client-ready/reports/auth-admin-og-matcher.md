# S4 — middleware matcher: anonymous share-card + crawler routes (routed from S6 / #54 follow-up)

Branch `claude/client-ready-auth-admin` off `origin/claude/client-ready` @ 5450844. Kept out of
`auth-admin.md` so it can't conflict with #41's appends to that file.

## Problem

S6's new share-card route `/og/he.png` and `/og/en.png` (`apps/web/app/og/[file]/route.tsx`, on
`claude/client-ready-landing` @ db072f1) went through `apps/web/middleware.ts`. That middleware is the
Auth.js `auth()` wrapper, and it stamps `Set-Cookie: authjs.csrf-token / authjs.callback-url` on every
response it handles. Public caches and CDNs won't cache a response that carries Set-Cookie.

The brief asked me to confirm that `/icon.svg`, `/robots.txt` and `/sitemap.xml` were already excluded.
**They were not.** The matcher on base was `'/((?!api/auth|_next/static|_next/image|favicon.ico).*)'`.
Those three files were *public*, through the `publicPaths` file-extension rule, but they were still
*matched*, so they also got the Auth.js cookies.

## Change

- **`apps/web/middleware.ts`:** the only change is the matcher. No auth, role, 2FA or CSP logic
  changed.
  - New matcher:
    `'/((?!api/auth|_next/static|_next/image|favicon.ico|og/|opengraph-image|icon.svg|robots.txt|sitemap.xml).*)'`
  - The middleware never runs on these paths, so they get no Set-Cookie and no CSP header. They are
    image, text and XML files, not documents.
  - The route stays anonymous and read-only: it is a `GET` that reads only its path segment.
- **`apps/web/lib/publicPaths.ts`:** the dead `/opengraph-image` entry is removed.
  - **Either merge order is safe.** The matcher also excludes `opengraph-image`, so the old
    `app/opengraph-image.tsx` on today's base stays anonymous. This holds whether this PR or S6's
    follow-up merges first (proven below).
  - `/twitter-image` was not in the brief, so I left it.
- **`apps/web/lib/__tests__/publicPaths.test.ts`:**
  - `/opengraph-image` is dropped from the "SEO/social asset is public" case, together with its
    entry. The matcher test now covers it.
  - `/og/he.png` and `/og/en.png` are added to that case.
- **`apps/web/lib/__tests__/middlewareMatcher.test.ts` (new, 21 tests):**
  - It reads the static matcher literal from `middleware.ts` and compiles it the way Next does.
    Next needs a literal there, so the matcher can't be imported from a module.
  - It asserts that the 6 crawler surfaces and the 4 framework/auth routes skip the middleware.
  - It asserts that `/`, `/dashboard`, `/dashboard/leaks`, `/admin`, `/scans/abc`, `/login`,
    `/settings`, `/api/trpc/…` and `/api/cron/…` still run it.
  - Look-alikes `/ogx` and `/dashboard/og/he.png` also still run it.

## Verification (2 layers)

**Layer 1 — branch gate**

- `apps/web` vitest **282/282** (27 files)
- eslint on the touched files: 0
- `tsc --noEmit`: 0 errors in touched files

**Layer 2 — production builds (`next build` + `next start`, NODE_ENV=production, local Postgres/Redis
only, dummy secrets, outbound mail to a file sink)**

*A) This branch merged with `origin/claude/client-ready-landing` @ db072f1 (S6's `/og` route).*
The merge was clean, in a scratch worktree, and was not pushed.

| Request | Result |
|---|---|
| `/og/he.png` anonymous | **200** `image/png` 1200×630, `Cache-Control: public, max-age=86400, s-maxage=86400`, **no Set-Cookie** |
| `/og/en.png` anonymous | **200** png 1200×630, same Cache-Control, **no Set-Cookie** |
| `/og/xx.png` | 404 text/plain, no Set-Cookie |
| `/icon.svg` | 200, `public, immutable, max-age=31536000`, **no Set-Cookie** |
| `/robots.txt`, `/sitemap.xml` | 200, `public, max-age=0, must-revalidate`, **no Set-Cookie** |
| the same 5 while **signed in** (manager) | 200, same Cache-Control, **no Set-Cookie**; the session still works afterwards |
| `/og` (bare, not excluded) | 307 → `/login?callbackUrl=%2Fog` (still gated) |
| `/dashboard`, `/admin` anonymous | **307 → `/login?callbackUrl=…`** (unchanged) |
| `/api/trpc/…` anonymous | JSON response, not a redirect (unchanged) |

**Auth-flow regression suite:** the Playwright `auth.mjs` from the round-A QA, against build A.
**48/48 PASS**, with 0 server 5xx and 0 console errors. It covers:

- wrong / unknown password gives the uniform error
- login + logout
- session cookie is httpOnly + Lax
- remember-me lifetime
- token_version revocation
- magic link
- 2FA enrol / verify / recovery / disable
- invite flow
- role change + per-member language
- admin panel
- `?lang` cookie
- CSP headers on documents
- login / magic-link / invite rate limits

On the first pass the invite rate-limit check failed. The harness's hour-bucketed key rolled over from
bucket `…869` to `…870` mid-test, so the 21st invite landed in a fresh hour. Re-run inside one bucket,
it **PASS**es: the 21st invite is throttled, with no email.

*B) This branch alone*, where the old `app/opengraph-image.tsx` still exists. This proves the merge
order doesn't matter.

- `/opengraph-image` anonymous: **200** PNG 1200×630, no Set-Cookie. It is not redirected to /login,
  even though its `publicPaths` entry is gone.
- `/icon.svg`, `/robots.txt`, `/sitemap.xml`: 200, no Set-Cookie.
- `/dashboard`: 307 → /login.
- `/` (document): 200, still middleware-handled (Auth.js cookies as before; CSP on documents is covered by the suite on build A).

No production touched: no Supabase, no Vercel, no real email.
