# Security review — merged `claude/client-ready` @ f171425 (S4)

Scope (orchestrator round 3): every tRPC procedure added/changed this sprint
(`git diff 0f21f07..f171425 -- packages/api`), new public routes + `?lang=` + CSP, the errorFormatter,
the new leak SQL (`packages/charts/src/leak-hero.ts`, `leak-report.ts`), and role gating of the
leak report / breakdown / credit-letter (claims) pages. S2 (english receiving) is not merged yet —
second pass when it lands.

## Findings

| # | Severity | Where | Finding | Fixed? |
|---|---|---|---|---|
| 1 | **Medium** | `packages/api/src/trpc.ts` (errorFormatter) | In production an unexpected error (Postgres/driver/bug) surfaced to clients as `INTERNAL_SERVER_ERROR` **with its raw message** — constraint/column names, SQL fragments. Stack inclusion depended only on tRPC's init-time `isDev`. | ✅ `publicErrorMessage()` (errors.ts) replaces uncoded internal messages with `Internal server error` in production; the formatter also drops `data.stack` in production. Deliberate / coded messages unchanged. Tests: `app-error-codes.test.ts` (unit + HTTP, prod vs dev). |
| 2 | **Medium** | `packages/api/src/routers/owner.ts` `leakBreakdown` | `memberProcedure` → a receiver/chef could call the invoice-level drill-down (supplier, invoice number, per-line ₪ deltas) directly over tRPC, although `/dashboard/leaks*` is owner/manager/bookkeeper only. | ✅ new `financeProcedure` (owner/manager/bookkeeper) in `trpc.ts`; bookkeeper keeps the claims page. Tests: `cross-tenant.attack.test.ts` role-denial block. |
| 3 | Low | `packages/api/src/routers/approvals.ts` `history` | `memberProcedure` → receiver/chef could read a discrepancy's decision trail (amounts, notes, who waived). Same-tenant only; pre-existing. | ✅ `financeProcedure`. Test added. |
| 4 | Info | `owner.leakHero` | Aggregate leak headline readable by every role (overview shows it to all). Deliberate S3 product choice ("it IS the product"); no invoice/supplier detail. | — (kept; flag for owner decision) |
| 5 | Info | `owner.leakReport` | `managerProcedure` — bookkeeper gets the page's "owner/manager only" note. Consistent with its supplier-spend content. | — |
| 6 | Info | `pnpm audit` CI job | Red on the base: high advisories in `sharp` (<0.35.5, via next), `compression`, `source-map-js` (via expo). | ↪ S7 (root `package.json` overrides) |

## Verified clean

- **Tenant scoping of new/changed procedures** — approvals (new decider role + joins all pinned to
  `restaurant_id`; `ensureCanAct` limits the bookkeeper to bookkeeper-routed items), orders (cancel
  guard, line edit/delete re-scoped through the PO join, `get` behind `assertPoOwned`, product names
  filtered by restaurant), catalog (`assertSupplierOwned` before parse; 9 MB upload cap; file errors
  as BAD_REQUEST), search/mapping/products/suppliers (`name_en` only added to restaurant-scoped
  queries), team/settings/dsr/admin (S4, covered earlier). COVERAGE manifest test passes: every
  procedure declared; new `owner.leak*` have real isolation assertions (A vs B spend / ids / names).
- **Leak SQL** (`leak-hero.ts`, `leak-report.ts`) — all values bound through drizzle's `sql` template
  (no `sql.raw` / string concatenation); every join re-pins `restaurant_id`; `month` is regex-validated
  in the router and re-parsed in the chart; `limit`/`monthOffset` are zod-bounded ints.
- **Public routes** — `/opengraph-image`, `/twitter-image` (static render, no params, no DB),
  `robots.txt` / `sitemap.xml` (static; robots disallows app/auth/API). Correctly listed in
  `publicPaths.ts`.
- **`?lang=` middleware** — only `he|en` accepted (`isLocale`); sets a non-sensitive preference cookie
  (`SameSite=Lax`, `Secure` on https); never reflected into HTML or redirects.
- **CSP/headers** — unchanged this sprint (`securityHeaders.ts` untouched); still Report-Only by design.
- **Server actions added this sprint** — all go through tRPC procedures (2FA-pending sessions are
  UNAUTHORIZED there) or only sign the user out.
- **Pages** — no new page reads the DB directly; leak report/breakdown/claims pages sit under
  `/dashboard/leaks` (middleware: owner/manager/bookkeeper) and call role-gated procedures.

## Gate

`pnpm test` → 12/12 tasks (api 455, web 182, charts 33, matching 86, db 45 …); web `tsc` 0 errors.

---

# Second pass — S2 "Receiver in English" (`claude/client-ready` @ 2cf22c8)

| # | Severity | Where | Finding | Fixed? |
|---|---|---|---|---|
| S2-1 | **Medium** | `packages/translate/src/composite.ts`, `packages/api/src/receiving/english.ts` | **Unbounded paid Claude calls.** `receiving.ensureEnglish` is a `memberProcedure` and the invoice + receiving pages call it on **every render**. Names Claude did not answer (or failed on) stayed NULL and were re-sent on every call — any member (or a reload loop) could drive unlimited Claude spend; the process memo was also unbounded. | ✅ Translator remembers Claude misses for 1 h and backs off 5 min after a failure; caches capped (10k). `ensureEnglish` adds a per-restaurant budget (30 Claude-eligible calls/hour, then glossary-only — lines still render). Tests: `translate/__tests__/claude-cost-guard.test.ts`, `api/__tests__/english-cost-guard.test.ts`. |
| S2-2 | Low | `packages/api/src/lib/scanUrls.ts` | `isAllowedScanUrl` **failed open** when no Supabase URL was configured — in production a missing/misnamed env var would re-open the worker SSRF (pre-existing, now on the S2 path). | ✅ Fails closed when `NODE_ENV=production`. Test in `scanUrls.test.ts`. |
| S2-3 | Low | `apps/web/app/scans/[invoiceId]/file/route.ts` | Local-scan file route checked only `session.user.id`, not `twoFactorPending` (middleware redirects pending sessions, but the route shouldn't depend on it). | ✅ 404 for a 2FA-pending session. |
| S2-4 | Info | default `onClaudeError` | Logged the raw error object (SDK errors can echo the request = invoice text). | ✅ Logs `err.message` only (test). |

**Verified clean (S2):**
- **Translator prompt injection** — invoice text goes to Claude only as JSON data (`{id, he}`), with
  structured-output JSON schema + zod validation. Ids map back by index, unknown ids are dropped, and
  output is capped at 300 chars. Rendered by React (escaped) and never executed. A 20 s timeout and
  `maxRetries: 1`. No API key or text in logs.
- **`ensureEnglish` tenant scoping** — PO/invoice re-verified against the session restaurant (foreign →
  NOT_FOUND); products updated only where `restaurant_id` matches; `MAX_ROWS` 400. Idempotent (`… IS NULL`
  re-checked on UPDATE).
- **Local scan storage** — disabled when `NODE_ENV=production`, when Supabase is configured, or with
  `LOCAL_SCAN_STORAGE=0`. The restaurant dir comes from the session (UUID-validated); scan ids match
  `^scan-[a-z0-9]+-[a-f0-9]{8}$` (no traversal); `ext` is sanitized. MIME is allowlisted at upload
  (pdf/jpeg/png/webp), so the served `content-type` can't be HTML; the route sends `nosniff`,
  `no-store` and `inline`.
- **`scans.upload` clientUploadId** — deterministic id = sha256(restaurantId:clientUploadId), so one tenant
  cannot collide into another's scan id.
- **`registerInvoice` advisory lock** — parameterized `hashtext(...)` key scoped by restaurant + object
  URL; `imageUrl` pinned to the private bucket prefix; GR + supplier ownership asserted.
- **Dev OCR stub** — `devOcrStubEnabled()` is false in production or with a real key.
- **`/scans/<invoice uuid>`** — resolved through the restaurant-scoped `receiving.getInvoice` and
  re-signed only under the caller's tenant prefix. A foreign UUID → 404.

**Gate (S2 pass):** `pnpm test` → 13/13 tasks (api 489, web 183, translate 67, ocr 44 …); web `tsc` 0;
`pnpm build` green.
