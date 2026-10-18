# Dashboard view options — report (S3)

The owner asked for advanced display options on the dashboards. This change adds one reusable set of view
controls and wires it into the overview, leaks (explorer, breakdown, report) and approvals pages. Every
control is a URL parameter, so a view is shareable and server-rendered, and the plain URL is still exactly
the old screen.

## What the owner gets

| Control | Values | URL key | Where |
|---|---|---|---|
| Period | this month · last month · quarter · year to date · last 12 months · custom range | `p`, `from`, `to` | overview, explorer, breakdown |
| Compare | off · previous period · same period last year → ▲/▼ deltas | `cmp` | overview, explorer, breakdown, report |
| Group by | supplier · category · product · discrepancy type | `g` | explorer |
| Filters | supplier · category · discrepancy type · severity · status | `sup`, `cat`, `type`, `sev`, `st` | overview (finance roles), explorer, breakdown, approvals (type/severity/supplier) |
| Chart | bars · line · table | `chart` | overview trend, explorer |
| Density | comfortable · compact | `d` | explorer, breakdown, approvals |
| TV mode | full-screen overlay; server re-render every 60 s; Esc to exit | `tv=1` | overview, explorer |
| CSV export | the rows on screen (UTF-8 BOM for Excel Hebrew; formula-injection guard) | — | overview trend, explorer, breakdown, report, approvals |
| Saved views | name → query string, per page, in this browser's `localStorage` (all access in try/catch) | — | overview, explorer, breakdown, approvals |

Pages:

- **`/dashboard`**:
  - toolbar plus hero;
  - with a comparison, the hero shows leak and spend deltas;
  - finance roles also get a leak trend (daily buckets for ranges up to 62 days, monthly otherwise);
  - the hero's drill-down link carries the period and filters into the breakdown.
- **`/dashboard/leaks`**:
  - the new **leak explorer** (finance roles) has four KPIs with deltas and a ranked group-by chart or table, with the comparison period shown as a ghost bar or column;
  - the price-leak detective below it stays owner-only.
- **`/dashboard/leaks/breakdown`**:
  - any period and filters go through `owner.leakBreakdown({ view })`;
  - `?m=` month paging is unchanged when no view parameter is present.
- **`/dashboard/leaks/report`**: `?cmp=prev|yoy` adds deltas against the previous month or the same month last year. The by-type table can be exported as CSV.
- **`/dashboard/approvals`**:
  - type, severity and supplier filters are passed through to `approvals.myQueue`, including on refresh and load-more;
  - compact density hides the "why flagged" panel.

## The hero number did not move

- The default view (this month, no comparison, no filters) still calls `owner.leakHero`, so that code path is untouched.
- Demo check after the change: `/dashboard` reads **₪572 · 2% of ₪28,389**, last month ₪1,137.
- `leak-canary.test.ts` and its fixtures are unchanged, and the canary passes.
- `computeLeakSummary` for the default view is asserted `toEqual` the hero. `last_month` equals the hero at `monthOffset: -1`.
- The grouped rows and the trend points are asserted to sum to the summary.
- One caveat on grouped rows: they sum discrepancy lines *before* the per-invoice cap. The UI shows a footnote whenever that total exceeds the capped leak.
- Filter semantics:
  - a supplier filter narrows both leak and spend;
  - type, severity, status and category filters narrow the leak only, so the percentage stays "of all checked spend".

## Security and tenancy

- New procedures:

  | Procedure | Access |
  |---|---|
  | `owner.leakSummary` | member, hero-equivalent |
  | `owner.viewOptions` | member |
  | `owner.leakGrouped` | finance (owner/manager/bookkeeper), exposes supplier/product detail |
  | `owner.leakTrend` | finance (owner/manager/bookkeeper), exposes supplier/product detail |

  `owner.leakBreakdown` gained an optional `view`.
- Every parameter is zod-validated:
  - periods, types, severities and statuses are enums;
  - supplier IDs must be UUIDs (max 50);
  - a custom range needs ISO dates and is capped at 3 years.
- Every value is bound through the drizzle `sql` template. Custom dates are validated by regex and also cast to `::date`.
- `restaurant_id` is pinned on every join.
- `cross-tenant.attack.test.ts` gained COVERAGE entries plus isolation tests for all four new procedures. It also checks:
  - receiver and chef get FORBIDDEN on grouped and trend;
  - bad input gets BAD_REQUEST.
- On the URL side, `parseView` sanitizes everything (unknown enum → default, bad UUID dropped, reversed range swapped, lists capped). The server re-validates.
- Role gating:
  - the explorer, trend and filters render only for roles that can see `/dashboard/leaks`;
  - the detective stays owner-only;
  - the report stays owner/manager.
- No schema change and no migration (saved views live in the browser), so `db:supabase-sync` was not needed.

## Files

- `packages/charts/src/leak-views.ts` (new). It holds the range, comparison, filter, group-by and trend SQL.
- `packages/charts/src/leak-hero.ts`: optional `view` on `computeLeakBreakdown`. The hero math is untouched.
- `packages/api/src/routers/owner.ts`, `approvals.ts`: new procedures and the `myQueue` filters.
- `apps/web/lib/components/views/**` (new, reusable, S8 can consume it):
  - `state.ts`, `labels.ts`, `csv.ts`, `savedViews.ts`;
  - `ViewToolbar.tsx`, `DeltaBadge.tsx`, `BreakdownChart.tsx`, `TvMode.tsx`.
- `apps/web/lib/i18n/messages/views/{he,en,index}.ts`: the new `views` namespace, registered in `ALL_NAMESPACES`.
- Pages:
  - `app/dashboard/page.tsx`;
  - `app/dashboard/leaks/{page,explorer}.tsx`;
  - `leaks/breakdown/page.tsx`, `leaks/report/page.tsx`;
  - `approvals/{page,list}.tsx`.
- Not touched:
  - `dashboard/{layout,nav}.tsx`;
  - the chain and branches pages;
  - the landing page;
  - any immutable file.

## Gate

| Check | Result |
|---|---|
| `pnpm test` (turbo, serial) | **13/13 tasks**, 1107 tests passed (api 500, web 209, charts 45, matching 86 …) |
| New tests | `charts/leak-views.test.ts` (12), `web/lib/components/views/__tests__/views.test.ts` (11), attack and approvals-router additions |
| web `tsc --noEmit` | 0 errors |
| web `eslint .` | 0 errors (6 pre-existing warnings in files not touched here) |
| `next build` | green |
| Screenshots | `docs/client-ready/screenshots/views-*.png`: 9 views × he/en desktop, plus 3 views × he/en at 390 px. No horizontal overflow |

The screenshot console reported only React hydration warnings about `caret-color`. These come from
Playwright's caret-hiding style during capture: they also hit a pre-existing search input and do not occur
in a real browser.

## Follow-ups (not in this PR)

- Trend comparison is shown as a period delta on the hero, not per point. Trend points are sparse (only days or months with invoices), so a per-point overlay needs a dense calendar series in SQL first.
- The approvals `info` severity is not offered as a filter. The view model's severities are the leak-relevant `warn` and `block`.
