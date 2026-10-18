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
